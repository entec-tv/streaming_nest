import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Customer, CustomerDocument } from '../schemas/customer.schema';
import { PaymentMethod, PaymentRecord, PaymentRecordDocument, PaymentStatus } from '../schemas/payment-record.schema';

export interface CreatePaymentInput {
  customerId: string;
  subscriptionId?: string;
  amount: number | string;
  currency: string;
  status: PaymentStatus;
  method: PaymentMethod;
  reference?: string;
  notes?: string;
}

@Injectable()
export class BillingService {
  constructor(
    @InjectModel(PaymentRecord.name) private readonly paymentModel: Model<PaymentRecordDocument>,
    @InjectModel(Customer.name) private readonly customerModel: Model<CustomerDocument>,
  ) {}

  async create(input: CreatePaymentInput, actor: { id: string; username: string }) {
    if (!Types.ObjectId.isValid(input.customerId)) throw new BadRequestException('العميل المحدد غير صالح');

    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000000) {
      throw new BadRequestException('أدخل مبلغًا أكبر من صفر ولا يتجاوز مليارًا');
    }
    if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) {
      throw new BadRequestException('أدخل المبلغ بمنزلتين عشريتين كحد أقصى');
    }

    const currency = String(input.currency || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException('رمز العملة يجب أن يتكون من 3 أحرف مثل SAR أو USD');
    if (![PaymentStatus.PENDING, PaymentStatus.PAID].includes(input.status)) {
      throw new BadRequestException('يمكن تسجيل الدفعة كقيد الانتظار أو مدفوعة فقط');
    }
    if (!Object.values(PaymentMethod).includes(input.method)) throw new BadRequestException('طريقة الدفع غير صحيحة');

    const customer = await this.customerModel.findById(input.customerId)
      .select('name subscriptions._id subscriptions.playlistName')
      .lean()
      .exec();
    if (!customer) throw new NotFoundException('العميل غير موجود');

    let subscriptionLabel: string | undefined;
    const subscriptionId = String(input.subscriptionId || '').trim();
    if (subscriptionId) {
      const subscription = (customer.subscriptions || []).find((item: any) => String(item._id) === subscriptionId);
      if (!subscription) throw new BadRequestException('الاشتراك المحدد لا يتبع هذا العميل');
      subscriptionLabel = subscription.playlistName || undefined;
    }

    const reference = String(input.reference || '').trim();
    const notes = String(input.notes || '').trim();
    if (reference.length > 120) throw new BadRequestException('رقم المرجع طويل جدًا');
    if (notes.length > 500) throw new BadRequestException('الملاحظات طويلة جدًا');

    const record = new this.paymentModel({
      customerId: customer._id,
      customerName: customer.name,
      subscriptionId: subscriptionId || undefined,
      subscriptionLabel,
      amountMinor: Math.round(amount * 100),
      currency,
      status: input.status,
      method: input.method,
      reference: reference || undefined,
      notes: notes || undefined,
      createdById: actor.id,
      createdByUsername: actor.username,
      paidAt: input.status === PaymentStatus.PAID ? new Date() : null,
    });

    const saved = await record.save();
    return this.toPublicPayment(saved.toObject());
  }

  async findRecent(page = 1, limit = 50, search = '', status?: string) {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit) || 50));
    const term = search.trim().slice(0, 100);
    const filter: Record<string, any> = {};
    if (term) {
      const escaped = this.escapeRegex(term);
      filter.$or = [
        { customerName: { $regex: escaped, $options: 'i' } },
        { reference: { $regex: escaped, $options: 'i' } },
        { createdByUsername: { $regex: escaped, $options: 'i' } },
      ];
    }
    if (status && Object.values(PaymentStatus).includes(status as PaymentStatus)) filter.status = status;

    const [payments, total] = await Promise.all([
      this.paymentModel.find(filter).sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean().exec(),
      this.paymentModel.countDocuments(filter),
    ]);

    return {
      payments: payments.map((payment) => this.toPublicPayment(payment)),
      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.ceil(total / safeLimit),
    };
  }

  async updateStatus(id: string, status: PaymentStatus) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('معرّف الدفعة غير صالح');
    if (!Object.values(PaymentStatus).includes(status)) throw new BadRequestException('حالة الدفعة غير صحيحة');

    const payment = await this.paymentModel.findById(id).exec();
    if (!payment) throw new NotFoundException('سجل الدفعة غير موجود');
    const allowedTransitions: Record<PaymentStatus, PaymentStatus[]> = {
      [PaymentStatus.PENDING]: [PaymentStatus.PAID, PaymentStatus.CANCELLED],
      [PaymentStatus.PAID]: [PaymentStatus.REFUNDED],
      [PaymentStatus.REFUNDED]: [],
      [PaymentStatus.CANCELLED]: [],
    };
    if (status !== payment.status && !allowedTransitions[payment.status].includes(status)) {
      throw new BadRequestException('تغيير حالة الدفعة غير مسموح من حالتها الحالية');
    }
    payment.status = status;
    if (status === PaymentStatus.PAID && !payment.paidAt) payment.paidAt = new Date();
    if (status === PaymentStatus.PENDING || status === PaymentStatus.CANCELLED) payment.paidAt = null;
    await payment.save();
    return this.toPublicPayment(payment.toObject());
  }

  async getSummary() {
    return this.paymentModel.aggregate([
      {
        $group: {
          _id: '$currency',
          count: { $sum: 1 },
          paid: { $sum: { $cond: [{ $eq: ['$status', PaymentStatus.PAID] }, '$amountMinor', 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$status', PaymentStatus.PENDING] }, '$amountMinor', 0] } },
          refunded: { $sum: { $cond: [{ $eq: ['$status', PaymentStatus.REFUNDED] }, '$amountMinor', 0] } },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, currency: '$_id', count: 1, paid: 1, pending: 1, refunded: 1 } },
    ]).exec().then((summary) => summary.map((item) => ({
      ...item,
      paid: item.paid / 100,
      pending: item.pending / 100,
      refunded: item.refunded / 100,
    })));
  }

  private toPublicPayment(payment: any) {
    const { amountMinor, ...record } = payment;
    return { ...record, amount: amountMinor / 100 };
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
