export interface NoticeSource {
  id: string;
  name: string;
  description: string;
  listUrl: string;
}

export interface NoticeListItem {
  sourceId: string;
  categoryLabel?: string;
  externalId: string;
  title: string;
  detailUrl: string;
  author?: string;
  publishedAt: string;
  publishedAtRaw: string;
}

export interface NoticeAttachment {
  fileName: string;
  downloadUrl: string;
  sortOrder: number;
}

export interface NoticeAssetImage {
  imageUrl: string;
  altText?: string;
  sortOrder: number;
}

export type NoticeAssetDownloadStatus = "pending" | "succeeded" | "failed";

export interface NoticeAssetProcessingUpdate {
  storageProvider?: "local" | null;
  storageKey?: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
  sha256?: string | null;
  downloadedAt?: string | null;
  downloadStatus: NoticeAssetDownloadStatus;
  errorMessage?: string | null;
}

export interface NoticeDetail extends NoticeListItem {
  bodyHtml: string;
  bodyText: string;
  contentHash: string;
  attachments: NoticeAttachment[];
  images: NoticeAssetImage[];
}
