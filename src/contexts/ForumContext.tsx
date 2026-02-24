import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useCredits } from "@/contexts/CreditsContext";
import type { ForumQuestion } from "@/lib/types";
import {
  answerForumQuestion,
  askForumQuestion,
  fetchForumQuestions,
  inviteForumAnswer,
  toggleForumLike,
  toggleForumSolved,
  type ForumListQuery,
} from "@/lib/forum-api";

const FORUM_ANSWER_REWARD_CREDITS = 50;
const DEFAULT_QUERY: ForumListQuery = { page: 1, page_size: 300, sort: "hot" };

type AskQuestionOptions = {
  tags?: string[];
  invitedUserIds?: string[];
};

type ForumContextValue = {
  questions: ForumQuestion[];
  askQuestion: (title: string, content: string, options?: AskQuestionOptions) => Promise<void>;
  answerQuestion: (questionId: string, content: string) => Promise<void>;
  inviteAnswer: (questionId: string, invitedUserIds: string[]) => Promise<void>;
  toggleSolved: (questionId: string) => Promise<void>;
  toggleLike: (questionId: string) => Promise<void>;
  reloadQuestions: (query?: ForumListQuery) => Promise<void>;
};

const ForumContext = createContext<ForumContextValue | null>(null);

function normalizeQuestion(raw: ForumQuestion): ForumQuestion {
  return {
    ...raw,
    likes: Array.isArray(raw.likes) ? raw.likes : [],
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    invitedUserIds: Array.isArray(raw.invitedUserIds) ? raw.invitedUserIds : [],
    answers: Array.isArray(raw.answers) ? raw.answers : [],
  };
}

export function ForumProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { grantReward } = useCredits();
  const [questions, setQuestions] = useState<ForumQuestion[]>([]);
  const [lastQuery, setLastQuery] = useState<ForumListQuery>(DEFAULT_QUERY);

  const reloadQuestions = useCallback(
    async (query?: ForumListQuery) => {
      if (!user) {
        setQuestions([]);
        return;
      }
      const nextQuery = { ...DEFAULT_QUERY, ...(query || {}) };
      setLastQuery(nextQuery);
      const res = await fetchForumQuestions(nextQuery);
      setQuestions((res.items || []).map(normalizeQuestion));
    },
    [user],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reloadQuestions(DEFAULT_QUERY);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [reloadQuestions]);

  const value = useMemo<ForumContextValue>(
    () => ({
      questions,
      askQuestion: async (title, content, options) => {
        if (!user) throw new Error("Please login first");
        await askForumQuestion({
          title,
          content,
          tags: options?.tags || [],
          invited_user_ids: options?.invitedUserIds || [],
        });
        await reloadQuestions(lastQuery);
      },
      answerQuestion: async (questionId, content) => {
        if (!user) throw new Error("Please login first");
        const res = await answerForumQuestion(questionId, content);
        setQuestions((prev) => prev.map((x) => (x.id === questionId ? normalizeQuestion(res.item) : x)));
        grantReward(FORUM_ANSWER_REWARD_CREDITS, "forum_answer");
      },
      inviteAnswer: async (questionId, invitedUserIds) => {
        if (!user) throw new Error("Please login first");
        const res = await inviteForumAnswer(questionId, invitedUserIds);
        setQuestions((prev) => prev.map((x) => (x.id === questionId ? normalizeQuestion(res.item) : x)));
      },
      toggleSolved: async (questionId) => {
        if (!user) throw new Error("Please login first");
        const res = await toggleForumSolved(questionId);
        setQuestions((prev) => prev.map((x) => (x.id === questionId ? normalizeQuestion(res.item) : x)));
      },
      toggleLike: async (questionId) => {
        if (!user) throw new Error("Please login first");
        const uid = user.id;
        const snapshot = questions;
        setQuestions((prev) =>
          prev.map((q) => {
            if (q.id !== questionId) return q;
            const liked = q.likes.includes(uid);
            const likes = liked ? q.likes.filter((id) => id !== uid) : [...q.likes, uid];
            return { ...q, likes };
          }),
        );
        try {
          const res = await toggleForumLike(questionId);
          setQuestions((prev) => prev.map((q) => (q.id === questionId ? normalizeQuestion(res.item) : q)));
        } catch (e) {
          setQuestions(snapshot);
          throw e;
        }
      },
      reloadQuestions,
    }),
    [questions, reloadQuestions, user, grantReward, lastQuery],
  );

  return <ForumContext.Provider value={value}>{children}</ForumContext.Provider>;
}

export function useForum() {
  const ctx = useContext(ForumContext);
  if (!ctx) throw new Error("useForum must be used inside ForumProvider");
  return ctx;
}
