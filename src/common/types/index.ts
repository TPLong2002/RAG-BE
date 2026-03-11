export type LLMProvider = "openai" | "google" | "aistudio";
export type EmbeddingProvider = "openai" | "google";

export interface AccessControl {
  public: boolean;
  allowedUsers: string[];
  allowedGroups: string[];
}

export interface DocumentMeta {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  totalChunks: number;
  ownerId: string;
  accessControl: AccessControl;
  embeddingProvider: EmbeddingProvider;
  embeddingModel: string;
  uploadedAt: string;
}

export interface ChunkMetadata {
  documentId: string;
  fileName: string;
  fileType: string;
  chunkIndex: number;
  ownerId: string;
  accessControl: AccessControl;
}

export interface ChatRequest {
  question: string;
  provider: LLMProvider;
  model: string;
  documentIds?: string[];
  userId?: string;
}

export interface ChatSource {
  documentId: string;
  fileName: string;
  chunkIndex: number;
  content: string;
  score: number;
  graphSource?: string;
}

export interface ModelInfo {
  provider: LLMProvider;
  id: string;
  name: string;
}

export interface UploadOptions {
  embeddingProvider: EmbeddingProvider;
  embeddingModel: string;
  ownerId?: string;
  hash?: string;
}

export interface SimilarityPair {
  sourceChunkId: string;
  targetChunkId: string;
  score: number;
}

export interface ChunkNeighbors {
  chunkId: string;
  prevChunkId: string | null;
  prevText: string | null;
  prevIndex: number | null;
  prevFileName: string | null;
  nextChunkId: string | null;
  nextText: string | null;
  nextIndex: number | null;
  nextFileName: string | null;
}

export interface RelatedDocument {
  documentId: string;
  fileName: string;
  score: number;
  connectionCount: number;
}

export interface GraphNode {
  id: string;
  label: string;
  type: "document" | "chunk" | "table";
  properties: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
