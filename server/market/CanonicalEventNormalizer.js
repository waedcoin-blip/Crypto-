import { tokenMintResolver } from './TokenMintResolver.js';
import { canonicalizeSolanaMint } from '../../src/utils/solanaValidators.js';
export class CanonicalEventNormalizer {
    /**
     * Generates deterministic eventId.
     */
    static generateEventId(source, mint, signature, slot, eventType) {
        if (signature && signature !== 'none' && !signature.startsWith('sig_')) {
            return `${source}:${signature}:${mint}:${eventType || 'TRADE'}`;
        }
        const slotPart = slot ? String(slot) : Math.floor(Date.now() / 3000).toString();
        return `${source}:${mint}:${eventType || 'TRADE'}:${slotPart}`;
    }
    /**
     * Generates correlationId for tracing token through pipeline.
     */
    static generateCorrelationId(source, mint) {
        return `corr_${source.toLowerCase()}_${mint.slice(0, 8)}_${Date.now()}`;
    }
    /**
     * Normalizes Pulse Feed incoming payload.
     */
    static normalizePulseTrade(rawTrade, network = 'mainnet') {
        if (!rawTrade)
            return null;
        const tradePayload = rawTrade;
        let mint;
        try {
            mint = canonicalizeSolanaMint(tradePayload.tokenAddress || tradePayload.token || tradePayload.mint);
        }
        catch {
            return null;
        }
        if (!tokenMintResolver.isValidPublicKey(mint)) {
            return null;
        }
        const now = Date.now();
        const side = (tradePayload.type || tradePayload.side || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
        const signature = tradePayload.signature || undefined;
        const solAmount = tradePayload.solAmount ? String(tradePayload.solAmount) : (tradePayload.amount ? String(tradePayload.amount) : undefined);
        const priceSol = tradePayload.priceSol ? Number(tradePayload.priceSol) : (tradePayload.price ? Number(tradePayload.price) : undefined);
        const eventId = this.generateEventId('PULSE_FEED', mint, signature, tradePayload.slot, side);
        const correlationId = this.generateCorrelationId('PULSE_FEED', mint);
        return {
            eventId,
            correlationId,
            chain: 'solana',
            source: 'PULSE_FEED',
            mint,
            signature,
            slot: tradePayload.slot ? Number(tradePayload.slot) : undefined,
            timestamp: tradePayload.timestamp || now,
            eventType: side === 'BUY' ? 'BUY' : 'SELL',
            side,
            tokenAmount: tradePayload.tokenAmount ? String(tradePayload.tokenAmount) : undefined,
            tokenAmountRaw: tradePayload.tokenAmount ? String(tradePayload.tokenAmount) : undefined,
            solAmount,
            solAmountRaw: solAmount,
            priceSol,
            buyer: side === 'BUY' ? (tradePayload.fromAccount || tradePayload.buyer || tradePayload.wallet) : undefined,
            seller: side === 'SELL' ? (tradePayload.fromAccount || tradePayload.seller || tradePayload.wallet) : undefined,
            confidence: 1.0,
            symbol: tradePayload.symbol || tradePayload.tokenSymbol || tradePayload.name || undefined,
            raw: tradePayload,
            network,
        };
    }
    /**
     * Normalizes Pump.fun bonding curve trade or creation event.
     */
    static normalizePumpFunEvent(params, network = 'mainnet') {
        let mint;
        try {
            mint = canonicalizeSolanaMint(params.mint);
        }
        catch {
            return null;
        }
        if (!tokenMintResolver.isValidPublicKey(mint)) {
            return null;
        }
        const now = Date.now();
        const eventType = params.isCreate ? 'TOKEN_DISCOVERED' : 'BONDING_TRADE';
        const side = params.isBuy ? 'BUY' : 'SELL';
        const eventId = this.generateEventId('PUMP_FUN', mint, params.signature, params.slot, eventType);
        const correlationId = this.generateCorrelationId('PUMP_FUN', mint);
        return {
            eventId,
            correlationId,
            chain: 'solana',
            source: 'PUMP_FUN',
            mint,
            signature: params.signature,
            slot: params.slot,
            timestamp: now,
            eventType,
            side: params.isCreate ? undefined : side,
            tokenAmount: params.tokenAmount,
            tokenAmountRaw: params.tokenAmount,
            solAmount: params.solAmount,
            solAmountRaw: params.solAmount,
            priceSol: params.priceSol,
            buyer: side === 'BUY' ? params.trader : undefined,
            seller: side === 'SELL' ? params.trader : undefined,
            confidence: 1.0,
            symbol: params.symbol,
            protocol: 'PUMP_FUN',
            raw: params.raw,
            network,
        };
    }
    /**
     * Normalizes DexScreener pair discovery into candidate event.
     */
    static normalizeDexScreenerCandidate(pair, network = 'mainnet') {
        if (!pair || !pair.baseToken?.address)
            return null;
        let mint;
        try {
            mint = canonicalizeSolanaMint(pair.baseToken.address);
        }
        catch {
            return null;
        }
        if (!tokenMintResolver.isValidPublicKey(mint)) {
            return null;
        }
        const now = Date.now();
        const eventId = this.generateEventId('DEXSCREENER', mint, pair.pairAddress, undefined, 'TOKEN_DISCOVERED');
        const correlationId = this.generateCorrelationId('DEXSCREENER', mint);
        return {
            eventId,
            correlationId,
            chain: 'solana',
            source: 'DEXSCREENER',
            mint,
            signature: pair.pairAddress,
            timestamp: now,
            eventType: 'TOKEN_DISCOVERED',
            priceSol: pair.priceNative ? Number(pair.priceNative) : undefined,
            confidence: 0.9,
            symbol: pair.baseToken.symbol || undefined,
            pool: pair.pairAddress,
            protocol: pair.dexId,
            raw: pair,
            network,
        };
    }
    /**
     * Normalizes LaserStream or Helius WSS transaction event.
     */
    static normalizeLaserStreamEvent(params, network = 'mainnet') {
        let mint;
        try {
            mint = canonicalizeSolanaMint(params.mint);
        }
        catch {
            return null;
        }
        if (!tokenMintResolver.isValidPublicKey(mint))
            return null;
        const now = Date.now();
        const eventType = params.eventType || (params.side ? params.side : 'TRADE');
        const eventId = this.generateEventId(params.source, mint, params.signature, params.slot, eventType);
        const correlationId = this.generateCorrelationId(params.source, mint);
        return {
            eventId,
            correlationId,
            chain: 'solana',
            source: params.source,
            mint,
            pool: params.pool,
            signature: params.signature,
            slot: params.slot,
            timestamp: now,
            eventType,
            side: params.side,
            tokenAmount: params.tokenAmount,
            tokenAmountRaw: params.tokenAmount,
            solAmount: params.solAmount,
            solAmountRaw: params.solAmount,
            priceSol: params.priceSol,
            protocol: params.protocol,
            confidence: 1.0,
            raw: params.raw,
            network,
        };
    }
}
