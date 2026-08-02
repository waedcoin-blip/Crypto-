import { useState, useEffect, useCallback } from 'react';
import { 
  JupiterTokenMetadata, 
  loadTokenMetadataByAddress, 
  searchJupiterTokens 
} from '../../services/jupiter/tokenSearchService';

export interface UseJupiterSearchReturn {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchResults: JupiterTokenMetadata[];
  selectedToken: JupiterTokenMetadata | null;
  setSelectedToken: (token: JupiterTokenMetadata | null) => void;
  loadedTokens: JupiterTokenMetadata[];
  loading: boolean;
  error: string | null;
  hasProfitableHistory: boolean;
  handleSearch: (query?: string) => Promise<void>;
  selectTokenByAddress: (address: string) => Promise<void>;
}

export const useJupiterSearch = (profitableTokenAddresses: string[] = []): UseJupiterSearchReturn => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<JupiterTokenMetadata[]>([]);
  const [selectedToken, setSelectedToken] = useState<JupiterTokenMetadata | null>(null);
  const [loadedTokens, setLoadedTokens] = useState<JupiterTokenMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasProfitableHistory = profitableTokenAddresses.length > 0;

  // Initialize search engine using received profitable token list
  useEffect(() => {
    let isMounted = true;

    const initializeProfitableTokens = async () => {
      if (!profitableTokenAddresses || profitableTokenAddresses.length === 0) {
        return;
      }

      setLoading(true);
      setError(null);

      const uniqueAddresses = [...new Set(
        profitableTokenAddresses.filter(addr => typeof addr === 'string' && addr.trim().length > 0)
      )];

      const loaded: JupiterTokenMetadata[] = [];

      for (const address of uniqueAddresses) {
        try {
          const meta = await loadTokenMetadataByAddress(address);
          if (meta && isMounted) {
            meta.isProfitableHistory = true;
            loaded.push(meta);
          }
        } catch (e) {
          console.warn(`[JupiterSearchHook]: Independent token load failed for ${address}:`, e);
          // Failures for one token must not stop the others
        }
      }

      if (isMounted) {
        setLoadedTokens(loaded);
        setSearchResults(loaded);
        if (loaded.length > 0) {
          setSelectedToken(loaded[0]);
        } else {
          setError("No profitable token history available. Use the search box to load a token manually.");
        }
        setLoading(false);
      }
    };

    initializeProfitableTokens();

    return () => {
      isMounted = false;
    };
  }, [JSON.stringify(profitableTokenAddresses)]);

  const handleSearch = useCallback(async (customQuery?: string) => {
    const q = (customQuery !== undefined ? customQuery : searchQuery).trim();
    if (!q) {
      setSearchResults(loadedTokens);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const results = await searchJupiterTokens(q);
      setSearchResults(results);
      if (results.length === 0) {
        setError(`No tokens found for "${q}". Try pasting a full Solana token address.`);
      }
    } catch (e: any) {
      setError(`Search failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, loadedTokens]);

  const selectTokenByAddress = useCallback(async (address: string) => {
    setLoading(true);
    try {
      const meta = await loadTokenMetadataByAddress(address);
      if (meta) {
        setSelectedToken(meta);
      } else {
        setError(`Failed to load details for token ${address}`);
      }
    } catch (e: any) {
      setError(`Error loading token: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    searchQuery,
    setSearchQuery,
    searchResults,
    selectedToken,
    setSelectedToken,
    loadedTokens,
    loading,
    error,
    hasProfitableHistory,
    handleSearch,
    selectTokenByAddress
  };
};
