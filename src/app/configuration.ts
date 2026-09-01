export interface AppConfig {
  network: 'paper' | 'mainnet';
  solanaRpcUrl: string;
  solanaWsUrl?: string;
}

export const defaultConfig: AppConfig = {
  network: 'paper',
  solanaRpcUrl: 'https://api.mainnet-beta.solana.com',
};
