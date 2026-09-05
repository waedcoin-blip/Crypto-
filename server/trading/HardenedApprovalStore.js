import crypto from 'crypto';
import { canonicalizeSolanaMint } from '../../src/utils/solanaValidators.js';
export class HardenedApprovalStore {
    static instance;
    // Key: approvalId
    approvals = new Map();
    // Key: `${chain}:${mint}:${pool || 'default'}` -> approvalId
    mintApprovals = new Map();
    constructor() {
        // Periodic cleanup of expired approvals
        setInterval(() => {
            this.cleanupExpired();
        }, 30000);
    }
    static getInstance() {
        if (!HardenedApprovalStore.instance) {
            HardenedApprovalStore.instance = new HardenedApprovalStore();
        }
        return HardenedApprovalStore.instance;
    }
    /**
     * Generates a deterministic audit hash of the decision.
     */
    static computeDecisionHash(params) {
        const serialized = JSON.stringify({
            id: params.approvalId,
            c: params.chain,
            m: params.mint,
            p: params.pool || 'none',
            v: params.criteriaVersion,
            s: params.evaluatedSlot,
            pr: params.evaluationPrice,
            ch: params.checks.map(c => `${c.ruleId}:${c.status}:${c.passed}`),
        });
        return crypto.createHash('sha256').update(serialized).digest('hex');
    }
    /**
     * Issues and stores a new HardenedApproval.
     */
    issueApproval(approval) {
        const canonicalMint = canonicalizeSolanaMint(approval.mint);
        approval.mint = canonicalMint;
        this.approvals.set(approval.approvalId, approval);
        const key = `${approval.chain}:${canonicalMint}:${approval.pool || 'default'}`;
        this.mintApprovals.set(key, approval.approvalId);
        console.log(`[HARDENED_APPROVAL_ISSUED] approvalId=${approval.approvalId} mint=${canonicalMint} pool=${approval.pool || 'default'} version=${approval.criteriaVersion} expiresAt=${approval.expiresAt} price=${approval.evaluationPrice.toFixed(8)} decisionHash=${approval.decisionHash.slice(0, 12)}...`);
        return approval;
    }
    /**
     * Retrieves an approval by its approvalId.
     */
    getApproval(approvalId) {
        return this.approvals.get(approvalId);
    }
    /**
     * Finds the latest usable approval for a mint and pool.
     */
    getLatestUsableApproval(chain, mint, pool) {
        let canonicalMint;
        try {
            canonicalMint = canonicalizeSolanaMint(mint);
        }
        catch {
            return undefined;
        }
        const key = `${chain}:${canonicalMint}:${pool || 'default'}`;
        const approvalId = this.mintApprovals.get(key);
        if (!approvalId)
            return undefined;
        const approval = this.approvals.get(approvalId);
        if (!approval)
            return undefined;
        const usability = this.isApprovalUsable(approval);
        if (!usability.valid) {
            return undefined;
        }
        return approval;
    }
    /**
     * Validates if an approval is currently usable.
     */
    isApprovalUsable(approval, currentPrice, currentSlot, activeCriteriaVersion) {
        const now = Date.now();
        if (approval.state === 'CONSUMED') {
            return { valid: false, reason: 'APPROVAL_ALREADY_CONSUMED: Single-use approval has already been consumed' };
        }
        if (approval.state === 'EXPIRED' || now > approval.expiresAt) {
            approval.state = 'EXPIRED';
            return { valid: false, reason: `APPROVAL_EXPIRED: Expiration reached (${now} > ${approval.expiresAt})` };
        }
        if (approval.state === 'INVALID') {
            return { valid: false, reason: 'APPROVAL_INVALID: Marked invalid' };
        }
        if (activeCriteriaVersion && approval.criteriaVersion !== activeCriteriaVersion) {
            return {
                valid: false,
                reason: `CRITERIA_VERSION_MISMATCH: Approval version ${approval.criteriaVersion} != active ${activeCriteriaVersion}`,
            };
        }
        if (currentSlot && currentSlot > 0 && approval.evaluatedSlot > 0) {
            const slotLag = currentSlot - approval.evaluatedSlot;
            if (slotLag > approval.maxSlotLag) {
                return {
                    valid: false,
                    reason: `SLOT_LAG_EXCEEDED: Evaluated slot ${approval.evaluatedSlot}, current ${currentSlot} (lag ${slotLag} > max ${approval.maxSlotLag})`,
                };
            }
        }
        if (currentPrice && currentPrice > 0 && approval.evaluationPrice > 0) {
            const deviationPct = Math.abs((currentPrice - approval.evaluationPrice) / approval.evaluationPrice) * 100;
            if (deviationPct > approval.maxPriceDeviationPct) {
                return {
                    valid: false,
                    reason: `PRICE_DEVIATION_EXCEEDED: Current price ${currentPrice} deviated ${deviationPct.toFixed(2)}% from evaluated ${approval.evaluationPrice} (max ${approval.maxPriceDeviationPct}%)`,
                };
            }
        }
        return { valid: true };
    }
    /**
     * Atomically transitions an approval to CONSUMING state for a buy attempt chain.
     */
    startConsuming(approvalId, orderId) {
        const approval = this.approvals.get(approvalId);
        if (!approval) {
            return { success: false, error: 'APPROVAL_NOT_FOUND' };
        }
        const check = this.isApprovalUsable(approval);
        if (!check.valid) {
            return { success: false, error: check.reason };
        }
        approval.state = 'CONSUMING';
        if (orderId)
            approval.consumedByOrderId = orderId;
        console.log(`[HARDENED_APPROVAL_CONSUMING] approvalId=${approval.approvalId} mint=${approval.mint} orderId=${orderId || 'none'}`);
        return { success: true };
    }
    /**
     * Transitions an approval to permanently CONSUMED state once execution is terminal.
     */
    markConsumed(approvalId, orderId) {
        const approval = this.approvals.get(approvalId);
        if (!approval)
            return;
        approval.state = 'CONSUMED';
        approval.consumedAt = Date.now();
        if (orderId)
            approval.consumedByOrderId = orderId;
        console.log(`[HARDENED_APPROVAL_CONSUMED] approvalId=${approval.approvalId} mint=${approval.mint} orderId=${orderId || 'none'} at=${approval.consumedAt}`);
    }
    /**
     * Invalidate an approval.
     */
    markInvalid(approvalId, reason) {
        const approval = this.approvals.get(approvalId);
        if (!approval)
            return;
        approval.state = 'INVALID';
        console.warn(`[HARDENED_APPROVAL_INVALID] approvalId=${approvalId} mint=${approval.mint} reason=${reason}`);
    }
    /**
     * Cleanup expired or consumed approvals from memory.
     */
    cleanupExpired() {
        const now = Date.now();
        for (const [id, app] of this.approvals.entries()) {
            if (app.state === 'CONSUMED' || now > app.expiresAt + 60000) {
                this.approvals.delete(id);
                const key = `${app.chain}:${app.mint}:${app.pool || 'default'}`;
                if (this.mintApprovals.get(key) === id) {
                    this.mintApprovals.delete(key);
                }
            }
        }
    }
    /**
     * Cleans up approval for a specific mint when a position is closed.
     */
    cleanupForMint(chain, mint, pool) {
        const key = `${chain}:${mint}:${pool || 'default'}`;
        const approvalId = this.mintApprovals.get(key);
        if (approvalId) {
            this.approvals.delete(approvalId);
            this.mintApprovals.delete(key);
        }
    }
}
export const hardenedApprovalStore = HardenedApprovalStore.getInstance();
