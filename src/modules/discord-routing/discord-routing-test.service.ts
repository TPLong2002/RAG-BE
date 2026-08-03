import { Injectable, Logger } from '@nestjs/common';
import {
  ChannelRow,
  MatchRule,
  ResolveResult,
  RuleValue,
} from './discord-routing.types';
import { cloneMockChannels, cloneMockFeatures } from './discord-routing-mock.data';

// ============================================================
// TYPES cho build JSON match_rule
// ============================================================

/**
 * Object các property người dùng nhập trên UI cấu hình channel.
 * Vd: { branch_id: 1, department_id: 2, customer_type_id: 3 }
 *     { branch_id: 1, department_id: [2, 5], time: { from: '08:00', to: '17:00' } }
 *
 * Quy ước giá trị (giống matches()):
 *   - mảng        → IN
 *   - {from,to}   → BETWEEN
 *   - còn lại     → EQ
 */
export type RuleProps = Record<string, RuleValue>;

export interface BuildRuleResult {
  /** rule sau khi chuẩn hoá (object) — null nghĩa là match-all (props rỗng) */
  rule: MatchRule;
  /** chuỗi JSON đúng như sẽ ghi vào cột match_rule — đem đi so sánh ở checkMatch */
  matchRuleJson: string | null;
  /** mô tả ngắn từng điều kiện cho UI */
  humanReadable: string[];
}

export interface CheckMatchResult {
  /** payload có khớp match_rule không */
  matched: boolean;
  /** rule đã parse (để FE hiển thị lại) */
  rule: MatchRule;
  /** lý do FAIL ở field nào (rỗng nếu matched=true) */
  failedOn: string | null;
}

// ============================================================
// SERVICE — bản test, chạy hoàn toàn trên MOCK DATA (không DB)
// ============================================================

@Injectable()
export class DiscordRoutingTestService {
  private readonly logger = new Logger(DiscordRoutingTestService.name);

  // ---------------------------------------------------------
  // API 1: resolve channel cho 1 feature (mock)
  // ---------------------------------------------------------

  /**
   * Trả về Discord channel ID cần gửi message — y hệt logic production
   * nhưng đọc từ MOCK_FEATURES / MOCK_CHANNELS.
   *
   * @param channelOverrides  (optional) danh sách channel mock đã được
   *   người dùng "sửa cấu hình" — nếu truyền vào sẽ thay cho mock mặc định.
   */
  resolveChannels(
    featureKey: string,
    payload: Record<string, any>,
    channelOverrides?: ChannelRow[],
  ): ResolveResult {
    const feature = cloneMockFeatures().find(
      (f) => f.feature_key === featureKey && f.is_active === 1,
    );

    if (!feature) {
      this.logger.warn(`[${featureKey}] feature không tồn tại / đã tắt`);
      return this.emptyResult();
    }

    const allChannels = channelOverrides ?? cloneMockChannels();
    const rows = allChannels
      .filter((c) => c.feature_id === feature.id && c.is_active === 1)
      .sort((a, b) => a.priority - b.priority || a.id - b.id);

    if (rows.length === 0) {
      this.logger.warn(`[${featureKey}] không có channel active`);
      return this.emptyResult();
    }

    const normals = rows.filter((r) => r.is_default === 0);
    const defaultCh = rows.find((r) => r.is_default === 1) ?? null;

    const matched: ChannelRow[] = [];
    for (const ch of normals) {
      const rule = this.parseRule(ch.match_rule, ch.id);
      // hàm con: nếu matches() == true => channel này được phép trả channel_id
      if (this.matches(payload, rule)) {
        matched.push(ch);
        if (feature.routing_mode === 'FIRST_MATCH') break;
      }
    }

    let usedDefault = false;
    if (matched.length === 0 && defaultCh) {
      matched.push(defaultCh);
      usedDefault = true;
    }

    if (matched.length === 0) {
      this.logger.warn(
        `[${featureKey}] không channel nào match & không có default — payload=${JSON.stringify(payload)}`,
      );
    }

    return {
      channelIds: matched.map((c) => c.channel_id),
      matchedBindingIds: matched.map((c) => c.id),
      usedDefault,
      resolved: matched.length > 0,
    };
  }

  // ---------------------------------------------------------
  // API 2 (HÀM CON): check 1 channel có khớp payload không -> true/false
  //   matched === true  => caller được phép trả về channel_id
  //   matched === false => bỏ qua channel này
  // ---------------------------------------------------------

  /**
   * @param matchRule  config thô của channel: object | chuỗi JSON | null
   * @param payload    payload sự kiện
   */
  checkMatch(
    matchRule: MatchRule | string | null | undefined,
    payload: Record<string, any>,
  ): CheckMatchResult {
    const rule = this.coerceRule(matchRule);
    const failedOn = this.firstFailingField(payload ?? {}, rule);
    return { matched: failedOn === null, rule, failedOn };
  }

  // ---------------------------------------------------------
  // API 3: build chuỗi JSON match_rule từ object các property
  //   Vd: buildMatchRuleJson({ branch_id: 1, department_id: 2, customer_type_id: 3 })
  //       -> '{"branch_id":1,"department_id":2,"customer_type_id":3}'
  //   Chuỗi JSON này đem đi so sánh ở checkMatch().
  // ---------------------------------------------------------

  buildMatchRuleJson(props: RuleProps | null | undefined): BuildRuleResult {
    const draft: Record<string, RuleValue> = {};

    for (const [key, value] of Object.entries(props ?? {})) {
      // bỏ field rỗng / null / undefined cho gọn
      if (value === undefined || value === null || value === '') {
        this.logger.warn(`Bỏ qua property rỗng: "${key}"`);
        continue;
      }
      draft[key] = value;
    }

    const rule: MatchRule = Object.keys(draft).length > 0 ? draft : null;
    const matchRuleJson = rule ? JSON.stringify(rule) : null;

    return {
      rule,
      matchRuleJson,
      humanReadable: this.describeRule(rule),
    };
  }

  // ============================================================
  // INTERNAL
  // ============================================================

  private parseRule(raw: string | null, channelId: number): MatchRule {
    if (!raw) return null;
    try {
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
      return Object.keys(obj).length > 0 ? obj : null;
    } catch {
      this.logger.error(`match_rule JSON lỗi ở channel #${channelId}: ${raw}`);
      return null;
    }
  }

  /** giống matches() production — wrapper boolean */
  private matches(payload: Record<string, any>, rule: MatchRule): boolean {
    return this.firstFailingField(payload, rule) === null;
  }

  /**
   * Trả về tên field đầu tiên bị FAIL, hoặc null nếu khớp hết.
   * Quy ước: array=IN, {from,to}=BETWEEN, còn lại=EQ, thiếu field=FAIL, các key AND.
   */
  private firstFailingField(
    payload: Record<string, any>,
    rule: MatchRule,
  ): string | null {
    if (!rule) return null; // match all

    for (const [key, cond] of Object.entries(rule)) {
      const val = payload[key];

      // IN
      if (Array.isArray(cond)) {
        if (!cond.includes(val)) return key;
        continue;
      }

      // BETWEEN
      if (
        cond !== null &&
        typeof cond === 'object' &&
        'from' in cond &&
        'to' in cond
      ) {
        if (val === undefined || val === null) return key;
        if (val < cond.from || val > cond.to) return key;
        continue;
      }

      // EQ
      if (val !== cond) return key;
    }

    return null;
  }

  // ---------- helpers ----------

  /** Chấp nhận object | JSON-string | null → MatchRule */
  private coerceRule(input: MatchRule | string | null | undefined): MatchRule {
    if (!input) return null;
    if (typeof input === 'string') return this.parseRule(input, -1);
    if (typeof input === 'object' && !Array.isArray(input)) {
      return Object.keys(input).length > 0 ? input : null;
    }
    return null;
  }

  private describeRule(rule: MatchRule): string[] {
    if (!rule) return ['(match mọi message)'];
    return Object.entries(rule).map(([k, cond]) => {
      if (Array.isArray(cond)) return `${k} ∈ [${cond.join(', ')}]`;
      if (cond !== null && typeof cond === 'object' && 'from' in cond && 'to' in cond) {
        return `${k} ∈ [${cond.from} … ${cond.to}]`;
      }
      return `${k} = ${cond}`;
    });
  }

  private emptyResult(): ResolveResult {
    return {
      channelIds: [],
      matchedBindingIds: [],
      usedDefault: false,
      resolved: false,
    };
  }
}
