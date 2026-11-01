import type { EnvironmentProfile } from "./specproof-config";

// 認証情報を平文の http で送らないための検査。依存を持たないので、単体で検査できる。
//
// https は通す。loopback（localhost / 127.0.0.0/8 / ::1）への http も既定で許す。それ以外の
// http は、選ばれた環境プロファイルが allowInsecureHttp: true を明示したときだけ通す。
// http でも https でもない scheme は止める。
// ホスト名は URL の解釈に任せる（大文字・10 進表記の IPv4 などは正規化される）。

// 制御文字・書式文字（bidi 制御・BOM を含む）・行区切りを ? にして表示する。
const printable = (text: string): string => text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "?");

const isLoopback = (hostname: string): boolean => {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const octets = hostname.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
};

/**
 * baseUrl が loopback 以外への http なら、env が allowInsecureHttp: true でない限り止める。
 * エラー文にはホストだけを出し、URL の認証情報・パス・クエリは出さない。
 */
export function assertSecureBaseUrl(baseUrl: string, env: EnvironmentProfile): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(
      "specproof: the base URL is not a valid URL; refusing to send credentials to it.",
    );
  }
  if (url.protocol === "https:") return;
  if (url.protocol !== "http:") {
    throw new Error(
      `specproof: the base URL must use https:// (or http:// to localhost); got ${printable(url.protocol)}`,
    );
  }
  if (isLoopback(url.hostname) || env.allowInsecureHttp === true) return;

  const name = printable(env.name);
  throw new Error(
    `specproof: refusing to send credentials over plain http to ${printable(url.host)}. ` +
      "Use https:// for any host other than localhost, 127.0.0.0/8 or ::1. " +
      `If this environment really has no https, opt in for it in specproof.config.yaml: ` +
      `add "allowInsecureHttp: true" to the environments[] entry "${name}".`,
  );
}
