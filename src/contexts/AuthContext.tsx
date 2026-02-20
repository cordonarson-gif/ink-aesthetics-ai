import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { AppUser, AuthProvider } from "@/lib/types";
import { loadSettings } from "@/lib/app-settings";
import {
  authChangePassword,
  authLoginOAuthMock,
  authLoginPassword,
  authLoginSms,
  authLogout,
  authMe,
  authRefresh,
  authRegister,
  authSendCode,
  authUpdateMe,
  type TokenPair,
} from "@/lib/auth-api";

const LS_ACCESS = "ink-aesthetics-ai.auth.access_token.v2";
const LS_REFRESH = "ink-aesthetics-ai.auth.refresh_token.v2";
const LS_SESSION = "ink-aesthetics-ai.auth.session.v1";

type SmsPurpose = "login" | "register";

type AuthContextValue = {
  ready: boolean;
  user: AppUser | null;
  users: AppUser[];
  registerWithPassword: (input: {
    username: string;
    displayName: string;
    password: string;
    phone?: string;
  }) => Promise<AppUser>;
  loginWithPassword: (input: { account: string; password: string }) => Promise<AppUser>;
  sendPhoneCode: (input: { phone: string; purpose: SmsPurpose }) => Promise<string>;
  registerWithPhone: (input: {
    username: string;
    phone: string;
    code: string;
    displayName: string;
    password: string;
  }) => Promise<AppUser>;
  loginWithPhone: (input: { phone: string; code: string }) => Promise<AppUser>;
  loginWithOAuth: (provider: Extract<AuthProvider, "qq" | "wechat">) => Promise<AppUser>;
  updateProfile: (patch: { displayName?: string }) => Promise<AppUser>;
  changePassword: (input: { oldPassword: string; newPassword: string }) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function toAppUser(u: {
  id: string;
  username: string;
  display_name: string;
  phone?: string | null;
  created_at: string;
}): AppUser {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name || u.username,
    phone: u.phone || undefined,
    password: "",
    createdAt: u.created_at,
  };
}

function saveTokens(access: string | null, refresh: string | null, userId: string | null) {
  if (access) localStorage.setItem(LS_ACCESS, access);
  else localStorage.removeItem(LS_ACCESS);
  if (refresh) localStorage.setItem(LS_REFRESH, refresh);
  else localStorage.removeItem(LS_REFRESH);
  if (userId) localStorage.setItem(LS_SESSION, JSON.stringify(userId));
  else localStorage.removeItem(LS_SESSION);
}

function getTokens() {
  return {
    access: localStorage.getItem(LS_ACCESS),
    refresh: localStorage.getItem(LS_REFRESH),
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AppUser | null>(null);
  const [tokens, setTokens] = useState<{ access: string | null; refresh: string | null }>({
    access: null,
    refresh: null,
  });

  async function applyTokenPair(pair: TokenPair) {
    const nextUser = toAppUser(pair.user);
    saveTokens(pair.access_token, pair.refresh_token, nextUser.id);
    setTokens({ access: pair.access_token, refresh: pair.refresh_token });
    setUser(nextUser);
    return nextUser;
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      const s = loadSettings();
      const { access, refresh } = getTokens();
      if (!access && !refresh) {
        if (mounted) setReady(true);
        return;
      }

      try {
        if (access) {
          const me = await authMe(s, access);
          if (!mounted) return;
          setTokens({ access, refresh });
          setUser(toAppUser(me));
          saveTokens(access, refresh, me.id);
          setReady(true);
          return;
        }
      } catch {
        // fallback refresh below
      }

      try {
        if (refresh) {
          const pair = await authRefresh(s, refresh);
          if (!mounted) return;
          await applyTokenPair(pair);
        } else {
          saveTokens(null, null, null);
        }
      } catch {
        if (!mounted) return;
        saveTokens(null, null, null);
        setTokens({ access: null, refresh: null });
        setUser(null);
      } finally {
        if (mounted) setReady(true);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      user,
      users: user ? [user] : [],
      registerWithPassword: async () => {
        throw new Error("当前注册仅支持手机号 + 验证码 + 密码。");
      },
      loginWithPassword: async ({ account, password }) => {
        const pair = await authLoginPassword(loadSettings(), { account, password });
        return await applyTokenPair(pair);
      },
      sendPhoneCode: async ({ phone, purpose }) => {
        const res = await authSendCode(loadSettings(), { phone, purpose });
        return res.dev_code || "";
      },
      registerWithPhone: async ({ username, phone, code, displayName, password }) => {
        const pair = await authRegister(loadSettings(), {
          username,
          phone,
          code,
          password,
          display_name: displayName,
        });
        return await applyTokenPair(pair);
      },
      loginWithPhone: async ({ phone, code }) => {
        const pair = await authLoginSms(loadSettings(), { phone, code });
        return await applyTokenPair(pair);
      },
      loginWithOAuth: async (provider) => {
        const pair = await authLoginOAuthMock(loadSettings(), { provider });
        return await applyTokenPair(pair);
      },
      updateProfile: async (patch) => {
        if (!tokens.access || !user) throw new Error("未登录。");
        const name = patch.displayName?.trim();
        if (!name) throw new Error("昵称不能为空。");
        const me = await authUpdateMe(loadSettings(), tokens.access, { display_name: name });
        const next = toAppUser(me);
        setUser(next);
        saveTokens(tokens.access, tokens.refresh, next.id);
        return next;
      },
      changePassword: async ({ oldPassword, newPassword }) => {
        if (!tokens.access) throw new Error("未登录。");
        await authChangePassword(loadSettings(), tokens.access, {
          old_password: oldPassword,
          new_password: newPassword,
        });
      },
      logout: async () => {
        await authLogout(loadSettings(), tokens.refresh);
        saveTokens(null, null, null);
        setTokens({ access: null, refresh: null });
        setUser(null);
      },
    }),
    [ready, user, tokens]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return ctx;
}
