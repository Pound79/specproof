import type { ProjectConfig } from "./specproof-config";

// 認証に使う環境変数の判定。依存を持たないので、単体で検査できる。

export interface Credentials {
  readonly username: string;
  readonly password: string;
  /** Set only when the app requires a forced password-change flow on first login. */
  readonly newPassword?: string;
}

type Env = Readonly<Record<string, string | undefined>>;

// ユーザー名は前後の空白を取り除く。パスワードは空白を含めて値そのものを使い、
// 未設定と空文字列だけを「無い」とみなす（空白を削ると正しいパスワードが別の値になる）。
const usernameOf = (value: string | undefined): string | undefined => {
  const next = value?.trim();
  return next ? next : undefined;
};

const secretOf = (value: string | undefined): string | undefined =>
  value === undefined || value === "" ? undefined : value;

/** project の認証に必要で、値が無い環境変数の名前。credentialsEnv が無ければその旨を返す。 */
export function missingCredentialEnv(p: ProjectConfig, env: Env = process.env): string[] {
  if (!p.credentialsEnv) return ["credentialsEnv (not configured)"];
  const { username, password } = p.credentialsEnv;
  return [
    ...(usernameOf(env[username]) === undefined ? [username] : []),
    ...(secretOf(env[password]) === undefined ? [password] : []),
  ];
}

/**
 * project の認証情報。ユーザー名かパスワードが無ければ null を返す。
 * newPassword は初回ログインでパスワード変更を求めるアプリだけが使う任意の値。
 */
export function credentialsFor(p: ProjectConfig, env: Env = process.env): Credentials | null {
  if (!p.credentialsEnv || missingCredentialEnv(p, env).length > 0) return null;
  const { username, password, newPassword } = p.credentialsEnv;
  return {
    username: usernameOf(env[username]) as string,
    password: env[password] as string,
    newPassword: newPassword === undefined ? undefined : secretOf(env[newPassword]),
  };
}
