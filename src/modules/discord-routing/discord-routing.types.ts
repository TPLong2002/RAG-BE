// ============================================================
// SHARED TYPES — Discord routing
// ============================================================

export type RuleValue =
  | string
  | number
  | boolean
  | Array<string | number>
  | { from: string | number; to: string | number };

/** JSON match_rule đã parse. null = match mọi message */
export type MatchRule = Record<string, RuleValue> | null;

export type RoutingMode = 'FIRST_MATCH' | 'BROADCAST';

/** 1 dòng discord_channel (đã join routing_mode của feature) */
export interface ChannelRow {
  id: number;
  feature_id: number;
  branch_id: number | null;
  channel_id: string;
  channel_label: string;
  priority: number;
  /** JSON string giống cột match_rule trong DB (NULL = match all) */
  match_rule: string | null;
  is_default: 0 | 1;
  is_active: 0 | 1;
}

export interface FeatureRow {
  id: number;
  feature_key: string;
  feature_name: string;
  routing_mode: RoutingMode;
  is_active: 0 | 1;
}

export interface ResolveResult {
  /** Discord channel ID(s) để gửi message */
  channelIds: string[];
  /** PK của discord_channel đã match — dùng cho audit log */
  matchedBindingIds: number[];
  /** Có rơi về default channel không */
  usedDefault: boolean;
  /** Có channel nào match không (kể cả default) */
  resolved: boolean;
}
