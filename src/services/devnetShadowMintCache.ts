export interface ShadowMintMapping {
  originalMint: string;
  devnetMint: string;
  decimals: number;
}

class DevnetShadowMintCache {
  private mainnetToDevnetMap = new Map<string, ShadowMintMapping>();
  private devnetToMainnetMap = new Map<string, string>();
  private initialFetchDone = false;

  public register(mapping: ShadowMintMapping): void {
    if (!mapping.originalMint || !mapping.devnetMint) return;
    this.mainnetToDevnetMap.set(mapping.originalMint, mapping);
    this.devnetToMainnetMap.set(mapping.devnetMint, mapping.originalMint);
  }

  public resolveDevnetMint(mint: string): string {
    const mapping = this.mainnetToDevnetMap.get(mint);
    return mapping ? mapping.devnetMint : mint;
  }

  public resolveMainnetMint(mint: string): string {
    const original = this.devnetToMainnetMap.get(mint);
    return original ? original : mint;
  }

  public getMappingForMainnet(originalMint: string): ShadowMintMapping | undefined {
    return this.mainnetToDevnetMap.get(originalMint);
  }

  public async fetchAllFromServer(): Promise<void> {
    try {
      const res = await fetch('/api/devnet-swap/shadow-mints').catch(() => null);
      if (res && res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.shadowMints) {
          Object.values(data.shadowMints).forEach((mapping: any) => {
            if (mapping.originalMint && mapping.devnetMint) {
              this.register({
                originalMint: mapping.originalMint,
                devnetMint: mapping.devnetMint,
                decimals: mapping.decimals ?? 6,
              });
            }
          });
        }
      }
      this.initialFetchDone = true;
    } catch (err) {
      console.warn('[DevnetShadowMintCache] Failed to fetch shadow mints from server:', err);
    }
  }

  public async ensureInitialized(): Promise<void> {
    if (!this.initialFetchDone) {
      await this.fetchAllFromServer();
    }
  }
}

export const devnetShadowMintCache = new DevnetShadowMintCache();
