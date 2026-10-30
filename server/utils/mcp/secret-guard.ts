/**
 * 写入前密钥守卫：记忆内容来自会话转录，可能携带真实凭据；
 * 入库后会被召回并回传给其他 Agent，因此命中即拒绝写入，不提供绕过通道。
 */
const SECRET_PATTERNS: { kind: string, pattern: RegExp }[] = [
  { kind: 'OpenAI/Anthropic API Key', pattern: /\bsk-(?:proj|ant)?-?[A-Za-z0-9_-]{32,}\b/ },
  { kind: 'GitHub Token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/ },
  { kind: 'GitHub Fine-grained Token', pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { kind: 'GitLab Token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { kind: 'AWS Access Key ID', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: 'Slack Token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  {
    kind: 'Private Key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/
  },
  { kind: 'JWT', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{5,}\b/ }
]

export interface SecretFinding {
  kind: string
  preview: string
}

/** 在多段文本中查找疑似密钥，返回首个命中（类型 + 脱敏前缀）或 null */
export function findSecretIn(texts: (string | undefined | null)[]): SecretFinding | null {
  for (const text of texts) {
    if (!text) continue
    for (const { kind, pattern } of SECRET_PATTERNS) {
      const match = text.match(pattern)
      if (match) {
        return { kind, preview: `${match[0].slice(0, 8)}…` }
      }
    }
  }
  return null
}

export function secretRefusal(finding: SecretFinding): string {
  return `拒绝写入：检测到疑似密钥/凭据（${finding.kind}，前缀 ${finding.preview}）。请先从内容中移除敏感信息后重试，本检测不提供绕过。`
}
