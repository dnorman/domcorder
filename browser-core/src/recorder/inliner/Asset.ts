import type { AssetFetchError } from '@domcorder/proto-ts';

export type Asset = {
  id: number;
  url: string;
  mime?: string;
  buf: ArrayBuffer;
  fetchError?: AssetFetchError;
};