export type GeneticParams = {
  styleInkWash: number; // 风格权重：水墨
  structureRhythm: number; // 气韵生动
  textureCun: number; // 皴法纹理
  edgeBleed: number; // 墨晕边缘
  multimodalFusion: number; // 多模态融合
};

export type GeneratedImage = {
  id: string;
  promptRaw: string;
  promptArtistic: string;
  dataUrl: string; // mock image data URL
  params: GeneticParams;
  createdAt: string; // ISO
  generationTaskId?: string;
  candidateId?: string;
  candidateIndex?: number;
};

export type ArchiveItem = GeneratedImage & {
  title: string;
  minted?: boolean;
  ownerUserId?: string;
};

export type AuthProvider = "password" | "email" | "qq" | "wechat";

export type AppUser = {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  phone?: string;
  password: string;
  createdAt: string;
};

export type GalleryComment = {
  id: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: string;
  moderationStatus: "approved" | "blocked";
  moderationReason?: string;
};

export type CommunityReport = {
  id: string;
  reporterUserId: string;
  reporterUserName: string;
  reason: string;
  createdAt: string;
};

export type PublishedArtwork = {
  id: string;
  archiveId: string;
  publishSource: "generated" | "upload";
  ownerUserId: string;
  ownerUserName: string;
  title: string;
  dataUrl: string;
  promptArtistic: string;
  params: GeneticParams;
  createdAt: string;
  publishedAt: string;
  aiGenerated: boolean;
  aiLabel: string;
  moderationStatus: "approved" | "hidden";
  moderationReason?: string;
  minted?: boolean;
  likes: string[]; // user ids
  comments: GalleryComment[];
  reports: CommunityReport[];
};

export type ForumAnswer = {
  id: string;
  questionId: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: string;
};

export type ForumQuestion = {
  id: string;
  userId: string;
  userName: string;
  title: string;
  content: string;
  tags: string[];
  invitedUserIds: string[];
  createdAt: string;
  solved: boolean;
  likes: string[];
  answers: ForumAnswer[];
};
