import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ArchiveItem, PublishedArtwork } from "@/lib/types";
import { useAuth } from "@/contexts/AuthContext";

const LS_KEY = "ink-aesthetics-ai.community.posts.v1";

type CommunityContextValue = {
  posts: PublishedArtwork[];
  publish: (item: ArchiveItem) => void;
  unpublish: (archiveId: string) => void;
  isPublished: (archiveId: string) => boolean;
  toggleLike: (postId: string) => void;
  addComment: (postId: string, content: string) => void;
};

const CommunityContext = createContext<CommunityContextValue | null>(null);

function readPosts(): PublishedArtwork[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PublishedArtwork[];
  } catch {
    return [];
  }
}

export function CommunityProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [posts, setPosts] = useState<PublishedArtwork[]>([]);

  useEffect(() => {
    setPosts(readPosts());
  }, []);

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(posts));
  }, [posts]);

  const value = useMemo<CommunityContextValue>(
    () => ({
      posts: [...posts].sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt)),
      publish: (item) => {
        if (!user) throw new Error("请先登录后发布。");
        setPosts((prev) => {
          const idx = prev.findIndex((x) => x.archiveId === item.id && x.ownerUserId === user.id);
          const nextPost: PublishedArtwork = {
            id: idx >= 0 ? prev[idx].id : crypto.randomUUID(),
            archiveId: item.id,
            ownerUserId: user.id,
            ownerUserName: user.displayName,
            title: item.title,
            dataUrl: item.dataUrl,
            promptArtistic: item.promptArtistic,
            params: item.params,
            createdAt: item.createdAt,
            publishedAt: idx >= 0 ? prev[idx].publishedAt : new Date().toISOString(),
            minted: item.minted,
            likes: idx >= 0 ? prev[idx].likes : [],
            comments: idx >= 0 ? prev[idx].comments : [],
          };
          if (idx < 0) return [nextPost, ...prev];
          return prev.map((x, i) => (i === idx ? nextPost : x));
        });
      },
      unpublish: (archiveId) => {
        if (!user) throw new Error("请先登录后操作。");
        setPosts((prev) => prev.filter((x) => !(x.archiveId === archiveId && x.ownerUserId === user.id)));
      },
      isPublished: (archiveId) => {
        if (!user) return false;
        return posts.some((x) => x.archiveId === archiveId && x.ownerUserId === user.id);
      },
      toggleLike: (postId) => {
        if (!user) throw new Error("请先登录后点赞。");
        setPosts((prev) =>
          prev.map((p) => {
            if (p.id !== postId) return p;
            const liked = p.likes.includes(user.id);
            return {
              ...p,
              likes: liked ? p.likes.filter((id) => id !== user.id) : [...p.likes, user.id],
            };
          })
        );
      },
      addComment: (postId, content) => {
        if (!user) throw new Error("请先登录后评论。");
        const c = content.trim();
        if (!c) throw new Error("评论不能为空。");
        setPosts((prev) =>
          prev.map((p) => {
            if (p.id !== postId) return p;
            return {
              ...p,
              comments: [
                ...p.comments,
                {
                  id: crypto.randomUUID(),
                  userId: user.id,
                  userName: user.displayName,
                  content: c,
                  createdAt: new Date().toISOString(),
                },
              ],
            };
          })
        );
      },
    }),
    [posts, user]
  );

  return <CommunityContext.Provider value={value}>{children}</CommunityContext.Provider>;
}

export function useCommunity() {
  const ctx = useContext(CommunityContext);
  if (!ctx) throw new Error("useCommunity 必须在 CommunityProvider 内使用");
  return ctx;
}
