import { ChannelRow, FeatureRow } from './discord-routing.types';

// ============================================================
// MOCK DATA — mô phỏng 2 bảng discord_feature / discord_channel
//   Dùng cho các API test, KHÔNG đụng DB.
// ============================================================

export const MOCK_FEATURES: FeatureRow[] = [
  {
    id: 1,
    feature_key: 'APPOINTMENT_FAILED',
    feature_name: 'Cảnh báo đặt lịch thất bại',
    routing_mode: 'FIRST_MATCH',
    is_active: 1,
  },
  {
    id: 2,
    feature_key: 'QUEUE_OVERLOAD',
    feature_name: 'Cảnh báo quá tải hàng đợi',
    routing_mode: 'BROADCAST',
    is_active: 1,
  },
];

export const MOCK_CHANNELS: ChannelRow[] = [
  // ---- APPOINTMENT_FAILED (FIRST_MATCH) ----
  {
    id: 11,
    feature_id: 1,
    branch_id: 1,
    channel_id: '1024873561029384712',
    channel_label: 'CN1 - Tim mạch (giờ hành chính)',
    priority: 10,
    match_rule: JSON.stringify({
      branch_id: 1,
      department: ['Cardiology', 'Pediatric'],
      time: { from: '08:00', to: '17:00' },
    }),
    is_default: 0,
    is_active: 1,
  },
  {
    id: 12,
    feature_id: 1,
    branch_id: 1,
    channel_id: '1024873561029384799',
    channel_label: 'CN1 - tất cả khoa',
    priority: 50,
    match_rule: JSON.stringify({ branch_id: 1 }),
    is_default: 0,
    is_active: 1,
  },
  {
    id: 13,
    feature_id: 1,
    branch_id: 2,
    channel_id: '1024873561029999000',
    channel_label: 'CN2 - tất cả khoa',
    priority: 50,
    match_rule: JSON.stringify({ branch_id: 2 }),
    is_default: 0,
    is_active: 1,
  },
  {
    id: 19,
    feature_id: 1,
    branch_id: null,
    channel_id: '1024873561029000DEF',
    channel_label: 'Kênh mặc định - APPOINTMENT_FAILED',
    priority: 100,
    match_rule: null,
    is_default: 1,
    is_active: 1,
  },

  // ---- QUEUE_OVERLOAD (BROADCAST) ----
  {
    id: 21,
    feature_id: 2,
    branch_id: null,
    channel_id: '2024873561029384712',
    channel_label: 'Trực vận hành toàn hệ thống',
    priority: 10,
    match_rule: null, // match all
    is_default: 0,
    is_active: 1,
  },
  {
    id: 22,
    feature_id: 2,
    branch_id: 1,
    channel_id: '2024873561029384799',
    channel_label: 'CN1 - cảnh báo tải cao',
    priority: 20,
    match_rule: JSON.stringify({ branch_id: 1, waiting_count: { from: 30, to: 9999 } }),
    is_default: 0,
    is_active: 1,
  },
  {
    id: 29,
    feature_id: 2,
    branch_id: null,
    channel_id: '2024873561029000DEF',
    channel_label: 'Kênh mặc định - QUEUE_OVERLOAD',
    priority: 100,
    match_rule: null,
    is_default: 1,
    is_active: 1,
  },
  {
    id: 14,
    feature_id: 1,
    branch_id: null,
    channel_id: '2024873561029000DEFtest',
    channel_label: 'Kênh test - APPOINTMENT_FAILED (rule đầy đủ)',
    priority: 10,
    match_rule:
      '{"branch_id":[1,2],"department_id":2,"customer_type_id":3,"time":{"from":"07:00","to":"17:00"}}',
    is_default: 0,
    is_active: 1,
  },
];

/** Trả về deep-copy để mỗi request test không vô tình ghi đè lẫn nhau */
export function cloneMockChannels(): ChannelRow[] {
  return MOCK_CHANNELS.map((c) => ({ ...c }));
}

export function cloneMockFeatures(): FeatureRow[] {
  return MOCK_FEATURES.map((f) => ({ ...f }));
}
