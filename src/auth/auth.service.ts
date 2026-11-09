import { Injectable, UnauthorizedException, ConflictException, ForbiddenException, OnModuleInit, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { timingSafeEqual } from 'node:crypto';
import { Admin, AdminDocument, AdminRole } from '../schemas/admin.schema';

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @InjectModel(Admin.name) private adminModel: Model<AdminDocument>,
    private jwtService: JwtService,
  ) {}

  async onModuleInit() {
    await this.adminModel.updateMany(
      { role: { $exists: false } },
      { $set: { role: AdminRole.ADMIN } },
    ).exec();

    const hasOwner = await this.adminModel.exists({ role: AdminRole.OWNER });
    if (hasOwner) return;

    const firstAdmin = await this.adminModel.findOne().sort({ createdAt: 1, _id: 1 }).exec();
    if (firstAdmin) {
      firstAdmin.role = AdminRole.OWNER;
      await firstAdmin.save();
    }
  }

  async login(username: string, password: string) {
    const admin = await this.adminModel.findOne({ username });
    if (!admin) throw new UnauthorizedException('بيانات الدخول غير صحيحة');

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) throw new UnauthorizedException('بيانات الدخول غير صحيحة');

    const role = admin.role || AdminRole.ADMIN;
    const payload = { sub: admin._id.toString(), username: admin.username, role };
    return {
      access_token: this.jwtService.sign(payload),
      admin: { username: admin.username, role },
    };
  }

  async createAdmin(username: string, password: string, role: AdminRole = AdminRole.ADMIN) {
    this.assertValidRole(role);
    const exists = await this.adminModel.findOne({ username });
    if (exists) throw new ConflictException('المستخدم موجود بالفعل');

    const hashed = await bcrypt.hash(password, 10);
    const admin = new this.adminModel({ username, password: hashed, role });
    await admin.save();
    return { _id: admin._id, username: admin.username, role: admin.role, createdAt: (admin as any).createdAt };
  }

  async createInitialAdmin(username: string, password: string, setupKey: string) {
    const configuredKey = process.env.ADMIN_SETUP_SECRET?.trim();
    if (!configuredKey || !setupKey) {
      throw new ForbiddenException('إعداد المدير الأول غير مفعّل');
    }

    const supplied = Buffer.from(setupKey);
    const expected = Buffer.from(configuredKey);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ForbiddenException('رمز الإعداد غير صحيح');
    }

    if (await this.adminModel.exists({})) {
      throw new ForbiddenException('تم إعداد حساب المدير مسبقاً');
    }

    return this.createAdmin(username, password, AdminRole.OWNER);
  }

  async getAdmins() {
    return this.adminModel.find({}, '-password').sort({ createdAt: -1 });
  }

  async updateAdmin(id: string, updateData: { username?: string; password?: string; role?: AdminRole }, actorId?: string) {
    if (updateData.role !== undefined) this.assertValidRole(updateData.role);
    const admin = await this.adminModel.findById(id);
    if (!admin) throw new ConflictException('المدير غير موجود');

    if (actorId === id && updateData.role && updateData.role !== admin.role) {
      throw new ForbiddenException('لا يمكن تغيير صلاحية حسابك بنفسك؛ استخدم حساب مالك آخر');
    }

    if (updateData.username && updateData.username !== admin.username) {
      const exists = await this.adminModel.findOne({ username: updateData.username });
      if (exists) throw new ConflictException('اسم المستخدم موجود بالفعل');
      admin.username = updateData.username;
    }

    if (updateData.password) {
      admin.password = await bcrypt.hash(updateData.password, 10);
    }

    if (updateData.role && updateData.role !== admin.role) {
      if (admin.role === AdminRole.OWNER && updateData.role !== AdminRole.OWNER) {
        const owners = await this.adminModel.countDocuments({ role: AdminRole.OWNER });
        if (owners <= 1) throw new ConflictException('يجب الإبقاء على مالك واحد على الأقل');
      }
      admin.role = updateData.role;
    }

    await admin.save();
    return { _id: admin._id, username: admin.username, role: admin.role, updatedAt: (admin as any).updatedAt };
  }

  async deleteAdmin(id: string, actorId?: string) {
    const admin = await this.adminModel.findById(id);
    if (!admin) throw new ConflictException('المدير غير موجود');
    if (actorId === id) throw new ForbiddenException('لا يمكن حذف حسابك الحالي؛ استخدم حساب مالك آخر');
    
    // Prevent deleting the last admin
    const count = await this.adminModel.countDocuments();
    if (count <= 1) throw new ConflictException('لا يمكن حذف المدير الوحيد في النظام');

    if (admin.role === AdminRole.OWNER) {
      const owners = await this.adminModel.countDocuments({ role: AdminRole.OWNER });
      if (owners <= 1) throw new ConflictException('يجب الإبقاء على مالك واحد على الأقل');
    }

    await this.adminModel.findByIdAndDelete(id);
    return { message: 'تم الحذف بنجاح' };
  }

  async getCurrentAdmin(id: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    const admin = await this.adminModel.findById(id).select('username role').lean().exec();
    if (!admin) return null;
    return { _id: String(admin._id), username: admin.username, role: admin.role || AdminRole.ADMIN };
  }

  private assertValidRole(role: AdminRole) {
    if (!Object.values(AdminRole).includes(role)) {
      throw new BadRequestException('صلاحية المدير غير صحيحة');
    }
  }
}
