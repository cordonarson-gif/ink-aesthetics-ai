import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ArchiveItem, PublishedArtwork } from "@/lib/types";
import { useAuth } from "@/contexts/AuthContext";
import { useCredits } from "@/contexts/CreditsContext";
import {
  addCommunityComment,
  fetchCommunityPosts,
  fetchFollowingFeed,
  fetchFollowingUsers,
  publishCommunityPost,
  removeCommunityPost,
  reportCommunityPost,
  toggleCommunityLike,
  toggleFollowAuthor,
} from "@/lib/community-api";

const PUBLISH_REWARD_CREDITS = 80;

type UploadPublishInput = {
  title: string;
  dataUrl: string;
  promptArtistic?: string;
};

type CommunityContextValue = {
  posts: PublishedArtwork[];
  followingFeed: PublishedArtwork[];
  followingUserIds: string[];
  publish: (item: ArchiveItem) => Promise<void>;
  publishUpload: (input: UploadPublishInput) => Promise<void>;
  unpublish: (archiveId: string) => Promise<void>;
  removePost: (postId: string) => Promise<void>;
  isPublished: (archiveId: string) => boolean;
  isFollowing: (targetUserId: string) => boolean;
  toggleFollow: (targetUserId: string) => Promise<void>;
  toggleLike: (postId: string) => Promise<void>;
  addComment: (postId: string, content: string) => Promise<void>;
  reportPost: (postId: string, reason: string) => Promise<void>;
  reloadPosts: () => Promise<void>;
  reloadFollowingFeed: () => Promise<void>;
};

const CommunityContext = createContext<CommunityContextValue | null>(null);

function mergeById(...groups: PublishedArtwork[][]): PublishedArtwork[] {
  const map = new Map<string, PublishedArtwork>();
  groups.flat().forEach((item) => {
    map.set(item.id, item);
  });
  return [...map.values()];
}

export function CommunityProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { grantReward } = useCredits();
  const [posts, setPosts] = useState<PublishedArtwork[]>([]);
  const [followingFeed, setFollowingFeed] = useState<PublishedArtwork[]>([]);
  const [followingUserIds, setFollowingUserIds] = useState<string[]>([]);

  const reloadFollowingFeed = useCallback(async () => {
    if (!user) {
      setFollowingFeed([]);
      setFollowingUserIds([]);
      return;
    }
    const [followingRes, feedRes] = await Promise.all([
      fetchFollowingUsers(),
      fetchFollowingFeed({ page: 1, page_size: 300 }),
    ]);
    setFollowingUserIds(followingRes.items || []);
    setFollowingFeed(feedRes.items || []);
  }, [user]);

  const reloadPosts = useCallback(async () => {
    if (!user) {
      setPosts([]);
      setFollowingFeed([]);
      setFollowingUserIds([]);
      return;
    }

    const [publicRes, mineRes, followingRes, feedRes] = await Promise.all([
      fetchCommunityPosts({ page: 1, page_size: 300 }),
      fetchCommunityPosts({ page: 1, page_size: 300, owner_only: true, include_hidden: true }),
      fetchFollowingUsers(),
      fetchFollowingFeed({ page: 1, page_size: 300 }),
    ]);

    setPosts(mergeById(publicRes.items || [], mineRes.items || []));
    setFollowingUserIds(followingRes.items || []);
    setFollowingFeed(feedRes.items || []);
  }, [user]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reloadPosts();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [reloadPosts]);

  const value = useMemo<CommunityContextValue>(
    () => ({
      posts,
      followingFeed,
      followingUserIds,
      publish: async (item) => {
        if (!user) throw new Error("Please login first");
        const existed = posts.some((x) => x.archiveId === item.id && x.ownerUserId === user.id);
        await publishCommunityPost({
          archive_id: item.id,
          publish_source: "generated",
          title: item.title,
          data_url: item.dataUrl,
          prompt_artistic: item.promptArtistic,
          params: item.params,
          created_at: item.createdAt,
          published_at: new Date().toISOString(),
          ai_generated: true,
          ai_label: "AI生成",
          minted: Boolean(item.minted),
        });
        if (!existed) {
          grantReward(PUBLISH_REWARD_CREDITS, "publish_artwork");
        }
        await reloadPosts();
      },
      publishUpload: async ({ title, dataUrl, promptArtistic }) => {
        if (!user) throw new Error("Please login first");
        await publishCommunityPost({
          publish_source: "upload",
          title,
          data_url: dataUrl,
          prompt_artistic: promptArtistic || "用户上传作品",
          params: {
            styleInkWash: 0.5,
            structureRhythm: 0.5,
            textureCun: 0.5,
            edgeBleed: 0.5,
            multimodalFusion: 0.5,
          },
          created_at: new Date().toISOString(),
          published_at: new Date().toISOString(),
          ai_generated: false,
          ai_label: "用户上传",
          minted: false,
        });
        grantReward(PUBLISH_REWARD_CREDITS, "publish_upload_artwork");
        await reloadPosts();
      },
      unpublish: async (archiveId) => {
        if (!user) throw new Error("Please login first");
        const row = posts.find((x) => x.archiveId === archiveId && x.ownerUserId === user.id);
        if (!row) return;
        await removeCommunityPost(row.id);
        await reloadPosts();
      },
      removePost: async (postId) => {
        if (!user) throw new Error("Please login first");
        await removeCommunityPost(postId);
        await reloadPosts();
      },
      isPublished: (archiveId) => {
        if (!user) return false;
        return posts.some((x) => x.archiveId === archiveId && x.ownerUserId === user.id);
      },
      isFollowing: (targetUserId) => followingUserIds.includes(targetUserId),
      toggleFollow: async (targetUserId) => {
        if (!user) throw new Error("Please login first");
        const previous = followingUserIds;
        const optimistic = previous.includes(targetUserId)
          ? previous.filter((id) => id !== targetUserId)
          : [...previous, targetUserId];
        setFollowingUserIds(optimistic);
        try {
          const res = await toggleFollowAuthor(targetUserId);
          setFollowingUserIds((curr) => {
            const has = curr.includes(targetUserId);
            if (res.following && !has) return [...curr, targetUserId];
            if (!res.following && has) return curr.filter((id) => id !== targetUserId);
            return curr;
          });
          await reloadFollowingFeed();
        } catch (e) {
          setFollowingUserIds(previous);
          throw e;
        }
      },
      toggleLike: async (postId) => {
        if (!user) throw new Error("Please login first");
        const userId = user.id;
        const previous = posts;
        setPosts((curr) =>
          curr.map((x) => {
            if (x.id !== postId) return x;
            const liked = x.likes.includes(userId);
            const likes = liked ? x.likes.filter((id) => id !== userId) : [...x.likes, userId];
            return { ...x, likes };
          })
        );
        try {
          const res = await toggleCommunityLike(postId);
          setPosts((curr) => curr.map((x) => (x.id === postId ? res.item : x)));
        } catch (e) {
          setPosts(previous);
          throw e;
        }
      },
      addComment: async (postId, content) => {
        if (!user) throw new Error("Please login first");
        const res = await addCommunityComment(postId, content);
        setPosts((prev) => prev.map((x) => (x.id === postId ? res.item : x)));
      },
      reportPost: async (postId, reason) => {
        if (!user) throw new Error("Please login first");
        const res = await reportCommunityPost(postId, reason);
        setPosts((prev) => prev.map((x) => (x.id === postId ? res.item : x)));
      },
      reloadPosts,
      reloadFollowingFeed,
    }),
    [posts, followingFeed, followingUserIds, grantReward, reloadPosts, reloadFollowingFeed, user]
  );

  return <CommunityContext.Provider value={value}>{children}</CommunityContext.Provider>;
}

export function useCommunity() {
  const ctx = useContext(CommunityContext);
  if (!ctx) throw new Error("useCommunity must be used inside CommunityProvider");
  return ctx;
}
