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
};

export type ArchiveItem = GeneratedImage & {
  title: string;
  minted?: boolean;
  ownerUserId?: string;
};

export type AuthProvider = "password" | "phone" | "qq" | "wechat";

export type AppUser = {
  id: string;
  username: string;
  displayName: string;
  phone?: string;
  qqOpenId?: string;
  wechatOpenId?: string;
  password: string; // mock-only; production must never store plain password
  createdAt: string;
};

export type GalleryComment = {
  id: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: string;
};

export type PublishedArtwork = {
  id: string;
  archiveId: string;
  ownerUserId: string;
  ownerUserName: string;
  title: string;
  dataUrl: string;
  promptArtistic: string;
  params: GeneticParams;
  createdAt: string;
  publishedAt: string;
  minted?: boolean;
  likes: string[]; // user ids
  comments: GalleryComment[];
};
