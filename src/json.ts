import { parse, stringify } from 'comment-json'

export function jsonParse<T = any>(content: string): T {
  return parse(content, null, true) as unknown as T
}

export function jsonStringify<T = any>(content: T): string {
  return stringify(content as any, null, 2) as string
}
