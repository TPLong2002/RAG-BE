import {
  IsArray,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { ChannelRow } from '../discord-routing.types';

// ============================================================
// API 1 — resolve channel cho 1 feature
// ============================================================

export class ResolveChannelsDto {
  /** vd: APPOINTMENT_FAILED | QUEUE_OVERLOAD */
  @IsString()
  @IsNotEmpty()
  featureKey: string;

  /** payload sự kiện, vd: { branch_id: 1, department_id: 2, time: '09:30' } */
  @IsObject()
  payload: Record<string, any>;

  /**
   * (optional) danh sách channel mock đã bị người dùng sửa — nếu truyền vào,
   * resolve sẽ dùng list này thay cho mock mặc định.
   */
  @IsOptional()
  @IsArray()
  channelOverrides?: ChannelRow[];
}

// ============================================================
// API 2 (HÀM CON) — check 1 channel có khớp payload không -> true/false
//   matched === true  => được phép trả channel_id của channel đó
// ============================================================

export class CheckMatchDto {
  /** payload sự kiện cần kiểm tra, vd: { branch_id: 1, department_id: 2 } */
  @IsObject()
  payload: Record<string, any>;

  /**
   * match_rule của channel — chấp nhận:
   *   - object   : { "branch_id": 1, "department_id": [2, 5] }
   *   - chuỗi JSON: "{\"branch_id\":1,\"department_id\":2}"   (chuỗi do build-match-rule trả ra)
   *   - null / bỏ trống : match mọi message
   */
  @IsOptional()
  matchRule?: Record<string, any> | string | null;

  /** (optional) channel_id sẽ được trả về khi matched=true — chỉ để demo cho dễ hình dung */
  @IsOptional()
  @IsString()
  channelId?: string;
}

// ============================================================
// API 3 — build chuỗi JSON match_rule từ object các property
//   body chính là { props: { branch_id: 1, department_id: 2, customer_type_id: 3 } }
// ============================================================

export class BuildMatchRuleDto {
  /**
   * Object các property người dùng nhập trên UI cấu hình channel.
   * Mỗi value:
   *   - số / chuỗi / bool   → EQ        vd: branch_id: 1
   *   - mảng                → IN        vd: department_id: [2, 5]
   *   - { from, to }        → BETWEEN   vd: time: { from: '08:00', to: '17:00' }
   * Object rỗng → match_rule = null (match mọi message).
   */
  @IsObject()
  props: Record<string, any>;
}
