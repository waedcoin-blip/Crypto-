// server/trading/HardenedApprovalStore.ts
import { createHash } from 'crypto';
import type { HardenedApproval, HardenedCriterionResult } from '../types/index.js';
import { logger } from '../utils/logger.js';

export type { HardenedApproval, HardenedCriterionResult };

function canonicalizeSolanaMint(mint: string): string {
  return mint.trim();
}

export class HardenedApprovalStore {
  private static instance: HardenedApprovalStore;
  private approvals: Map<string, HardenedApproval> = new Map();
  private mintIndex: Map<string, string[]> = new Map(); // canonicalMint -> approvalIds

  private constructor() {
    // FIX: Periodic cleanup with .unref() to prevent memory leaks
    const cleanupInterval = setInterval(() => this.cleanupExpired(), 30000);
    if (cleanupInterval.unref) cleanupInterval.unref();
  }

  public static getInstance(): HardenedApprovalStore {
    if (!HardenedApprovalStore.instance) {
      HardenedApprovalStore.instance = new HardenedApprovalStore();
    }
    return HardenedApprovalStore.instance;
  }

  // ==========================================
  // DECISION HASH (Cryptographic binding)
  // ==========================================

  public static computeDecisionHash(params: {
    approvalId: string;
    chain: string;
    mint: string;
    criteriaVersion?: string;
    pool?: string;
    evaluatedSlot?: number;
    evaluationPrice?: number;
    checks?: HardenedCriterionResult[];
    [key: string]: any;
  }): string {
    const payload = JSON.stringify({
      approvalId: params.approvalId,
      chain: params.chain,
      mint: canonicalizeSolanaMint(params.mint),
      criteriaVersion: params.criteriaVersion || '1.0',
      evaluatedSlot: params.evaluatedSlot ?? 0,
      evaluationPrice: params.evaluationPrice ?? 0,
      checksCount: params.checks?.length ?? 0,
      passedCount: params.checks?.filter(c => c.passed).length ?? 0,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  public computeDecisionHash(params: {
    approvalId: string;
    chain: string;
    mint: string;
    criteriaVersion?: string;
    pool?: string;
    evaluatedSlot?: number;
    evaluationPrice?: number;
    checks?: HardenedCriterionResult[];
    [key: string]: any;
  }): string {
    return HardenedApprovalStore.computeDecisionHash(params);
  }

  // ==========================================
  // ISSUANCE
  // ==========================================

  public issueApproval(approval: HardenedApproval): HardenedApproval {
    const canonicalMint = canonicalizeSolanaMint(approval.mint);
    approval.mint = canonicalMint;

    this.approvals.set(approval.approvalId, approval);

    // Index by mint for fast lookup
    if (!this.mintIndex.has(canonicalMint)) {
      this.mintIndex.set(canonicalMint, []);
    }
    this.mintIndex.get(canonicalMint)!.push(approval.approvalId);

    logger.debug({
      approvalId: approval.approvalId,
      mint: canonicalMint,
      version: approval.criteriaVersion,
      expiresAt: approval.expiresAt,
    }, '[HardenedApprovalStore] Approval issued');

    return approval;
  }

  // ==========================================
  // RETRIEVAL
  // ==========================================

  public getApproval(approvalId: string): HardenedApproval | undefined {
    return this.approvals.get(approvalId);
  }

  public getApprovalByClientRequestId(clientRequestId: string): HardenedApproval | undefined {
    for (const approval of this.approvals.values()) {
      if (approval.correlationId?.includes(clientRequestId)) return approval;
    }
    return undefined;
  }

  public getLatestUsableApproval(
    chain: string,
    mint: string,
    pool?: string,
    currentPrice?: number,
    currentSlot?: number
  ): HardenedApproval | undefined {
    let canonicalMint: string;
    try {
      canonicalMint = canonicalizeSolanaMint(mint);
    } catch {
      return undefined;
    }

    const approvalIds = this.mintIndex.get(canonicalMint) || [];
    const now = Date.now();

    // Iterate from newest to oldest
    for (let i = approvalIds.length - 1; i >= 0; i--) {
      const approval = this.approvals.get(approvalIds[i]);
      if (!approval) continue;

      // Must be ISSUED state
      if (approval.state !== 'ISSUED') continue;

      // Must not be expired
      if (now > approval.expiresAt) continue;

      // Chain must match
      if (approval.chain !== chain) continue;

      // Slot lag check (if provided)
      if (currentSlot !== undefined && approval.evaluatedSlot > 0) {
        const slotLag = currentSlot - approval.evaluatedSlot;
        if (slotLag > approval.maxSlotLag) continue;
      }

      // Price deviation check (if provided)
      if (currentPrice !== undefined && approval.evaluationPrice > 0) {
        const deviation = Math.abs((currentPrice - approval.evaluationPrice) / approval.evaluationPrice) * 100;
        if (deviation > approval.maxPriceDeviationPct) continue;
      }

      return approval;
    }

    return undefined;
  }

  // ==========================================
  // STATE TRANSITIONS
  // ==========================================

  public startConsuming(approvalId: string, clientRequestId?: string): void {
    const approval = this.approvals.get(approvalId);
    if (!approval) return;
    approval.state = 'CONSUMING';
    if (clientRequestId) {
      approval.correlationId = `${approval.correlationId}:${clientRequestId}`;
    }
  }

  public markConsumed(approvalId: string, orderId: string): void {
    const approval = this.approvals.get(approvalId);
    if (!approval) return;
    approval.state = 'CONSUMED';
    logger.debug({ approvalId, orderId }, '[HardenedApprovalStore] Approval consumed');
  }

  public markInvalid(approvalId: string, reason?: string): void {
    const approval = this.approvals.get(approvalId);
    if (!approval) return;
    approval.state = 'INVALID';
    logger.warn({ approvalId, reason }, '[HardenedApprovalStore] Approval marked invalid');
  }

  // ==========================================
  // CLEANUP
  // ==========================================

  private cleanupExpired(): void {
    const now = Date.now();
    let pruned = 0;

    for (const [id, approval] of this.approvals.entries()) {
      // Remove expired or terminal approvals older than 5 minutes
      const isTerminal = ['CONSUMED', 'INVALID', 'EXPIRED'].includes(approval.state);
      const isExpired = now > approval.expiresAt + 300000; // 5 min grace period

      if ((isTerminal && isExpired) || (now > approval.expiresAt + 600000)) {
        this.approvals.delete(id);
        const mintIds = this.mintIndex.get(approval.mint);
        if (mintIds) {
          const idx = mintIds.indexOf(id);
          if (idx !== -1) mintIds.splice(idx, 1);
          if (mintIds.length === 0) this.mintIndex.delete(approval.mint);
        }
        pruned++;
      }
    }

    if (pruned > 0) {
      logger.debug({ pruned }, '[HardenedApprovalStore] Pruned expired approvals');
    }
  }

  public getTelemetry() {
    const byState: Record<string, number> = {};
    for (const approval of this.approvals.values()) {
      byState[approval.state] = (byState[approval.state] || 0) + 1;
    }
    return { totalApprovals: this.approvals.size, byState };
  }
}

export const hardenedApprovalStore = HardenedApprovalStore.getInstance();
