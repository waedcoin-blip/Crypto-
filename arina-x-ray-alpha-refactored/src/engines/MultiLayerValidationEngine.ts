export type TokenState = 'BONDING_CURVE' | 'GRADUATED';

export interface TokenTelemetry {
  symbol: string;
  mintAddress: string;
  dexId: string;               // مثال: 'raydium', 'pumpswap', 'pump-fun', 'orca', 'meteora'
  bondingProgress: number;     // نسبة اكتمال المنحنى من 0 إلى 100
  marketCapUSD: number;
  virtualLiquidityUSD: number; // السيولة الافتراضية لفحص منحنى الارتباط
  ammLiquidityUSD: number;     // السيولة الفعلية في حوض الـ DEX المفتوح
}

export interface RouteConfig {
  minMarketCap: number;
  maxMarketCap: number;
  minLiquidityUSD: number;
  enforceProgressLimits: boolean;
  minProgress?: number;
  maxProgress?: number;
}

export class MultiLayerValidationEngine {
  // 1️⃣ الطبقة الأولى: مؤشر مطابقة المنصات المهاجرة والمكتملة
  private readonly GRADUATED_SIGNATURES = new Set(['raydium', 'pumpswap', 'orca', 'meteora']);

  // 3️⃣ الطبقة الثالثة: مصفوفة بارامترات التوجيه المخصصة مع تعيين نوع صريح لمنع أخطاء الاستنتاج
  private readonly ROUTING_RULES: Record<TokenState, RouteConfig> = {
    BONDING_CURVE: {
      minMarketCap: 10000,
      maxMarketCap: 75000,
      minLiquidityUSD: 5000,         // فحص وتقييم السيولة الافتراضية (Virtual Liquidity)
      enforceProgressLimits: true,
      minProgress: 70.0,             // الحد الأدنى المستهدف لبدء قنص المنحنى
      maxProgress: 95.0              // عتبة الحماية لتجنب الهجرة أثناء التنفيذ
    },
    GRADUATED: {
      minMarketCap: 65000,
      maxMarketCap: 5000000,
      minLiquidityUSD: 15000,        // فحص وتقييم سيولة أحواض الـ AMM الحقيقية والدولارية
      enforceProgressLimits: false   // تجاوز وإلغاء كافة قيود المنحنى تلقائياً
    }
  };

  /**
   * نقطة الدخول الرئيسية: تحليل البيانات الحركية وتوجيه الفلاتر فوراً
   */
  public validateTokenRoute(
    telemetry: TokenTelemetry
  ): { isPassed: boolean; classification: TokenState; reason: string } {
    // 1️⃣ تنفيذ الطبقة الأولى: تحديد هوية المنصة وسياق السيولة
    const classification = this.identifyPlatform(telemetry.dexId);

    // 2️⃣ تنفيذ الطبقة الثانية: إعادة مواءمة بيانات منحنى الارتباط وتصفير القيود
    const processedProgress = this.alignBondingTelemetry(
      classification,
      telemetry.bondingProgress
    );

    // 3️⃣ تنفيذ الطبقة الثالثة: جلب الإعدادات مباشرة وبأمان تام من مصفوفة القواعد
    const routeSettings = this.ROUTING_RULES[classification];

    return this.executeRuleEvaluation(
      telemetry,
      classification,
      processedProgress,
      routeSettings
    );
  }

  /**
   * منطق الطبقة الأولى: مطابقة المعرفات بدقة فائقة وتعقيد زمني حقيقي O(1)
   */
  public identifyPlatform(dexId: string): TokenState {
    if (!dexId) return 'BONDING_CURVE';

    const cleanDexId = dexId.toLowerCase().trim();

    // تصحيح الأداء: استخدام .includes() الفرعي لدعم المتغيرات مثل 'raydium-clmm' و 'raydium-cpmm'
    if (
      cleanDexId.includes('raydium') ||
      cleanDexId.includes('pumpswap') ||
      cleanDexId.includes('orca') ||
      cleanDexId.includes('meteora')
    ) {
      return 'GRADUATED';
    }

    return 'BONDING_CURVE'; // السقوط الآمن التلقائي لبيانات pump-fun الخام
  }

  /**
   * منطق الطبقة الثانية: تخطي وفك قيود المنحنيات للعملات المهاجرة
   */
  public alignBondingTelemetry(
    state: TokenState,
    reportedProgress: number
  ): number {
    if (state === 'GRADUATED') {
      // تعطيل القيود الديناميكية وفرض حالة الإغلاق الرياضي التام للمنحنى
      return 100.0;
    }

    return reportedProgress;
  }

  /**
   * منطق الطبقة الثالثة: تطبيق شروط الفلاتر الصارمة حسب مسار العملة
   */
  private executeRuleEvaluation(
    token: TokenTelemetry,
    state: TokenState,
    progress: number,
    rules: RouteConfig
  ): { isPassed: boolean; classification: TokenState; reason: string } {

    // أولاً: التحقق من حدود القيمة السوقية (Market Cap)
    if (
      token.marketCapUSD < rules.minMarketCap ||
      token.marketCapUSD > rules.maxMarketCap
    ) {
      return {
        isPassed: false,
        classification: state,
        reason: `Market Cap Out of Bounds ($${token.marketCapUSD})`
      };
    }

    // ثانياً: التحقق من كفاية السيولة النشطة (افتراضية للمنحنى مقابل فعلية للـ DEX)
    const activeLiquidity =
      state === 'GRADUATED'
        ? token.ammLiquidityUSD
        : token.virtualLiquidityUSD;

    if (activeLiquidity < rules.minLiquidityUSD) {
      return {
        isPassed: false,
        classification: state,
        reason: `Insufficient Active Liquidity ($${activeLiquidity})`
      };
    }

    // ثالثاً: فحص نطاق اكتمال منحنى الارتباط (خاص بـ Pump.fun فقط)
    if (rules.enforceProgressLimits) {
      if (
        rules.minProgress !== undefined &&
        progress < rules.minProgress
      ) {
        return {
          isPassed: false,
          classification: state,
          reason: `Progress below target curve floor (${progress}%)`
        };
      }

      if (
        rules.maxProgress !== undefined &&
        progress > rules.maxProgress
      ) {
        return {
          isPassed: false,
          classification: state,
          reason: `Progress inside graduation danger zone (${progress}%)`
        };
      }
    }

    return {
      isPassed: true,
      classification: state,
      reason: 'All constraints successfully verified.'
    };
  }
}

export const validationEngine = new MultiLayerValidationEngine();
