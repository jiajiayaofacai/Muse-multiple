export type CreativeMode = 'image' | 'video';
export type CreativeTaskStatus = 'queued' | 'processing' | 'completed' | 'failed';
export interface CreativeConnection { connected: boolean; baseUrl: string | null }
export interface CreativeTask { id: string; mode: CreativeMode; status: CreativeTaskStatus; progress: number; mediaUrl: string | null }
