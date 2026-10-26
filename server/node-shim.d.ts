/**
 * Minimal ambient Node.js typings for the server and its tests (no @types/node: rule 7, no new dependencies).
 * Declares only what server/* and tests/unit/net*.test.ts use. Owner: net agent.
 */

interface Buffer extends Uint8Array {
  readUInt16BE(offset?: number): number;
  writeUInt16BE(value: number, offset?: number): number;
  readBigUInt64BE(offset?: number): bigint;
  writeBigUInt64BE(value: bigint, offset?: number): number;
  readDoubleBE(offset?: number): number;
  writeDoubleBE(value: number, offset?: number): number;
  toString(encoding?: 'utf8' | 'base64' | 'hex'): string;
  copy(target: Uint8Array, targetStart?: number): number;
  subarray(start?: number, end?: number): Buffer;
}
declare const Buffer: {
  alloc(size: number): Buffer;
  from(data: string, encoding?: 'utf8' | 'base64' | 'hex'): Buffer;
  from(data: ArrayLike<number> | ArrayBuffer): Buffer;
  concat(list: readonly Uint8Array[]): Buffer;
};

declare const process: {
  argv: string[];
  exit(code?: number): never;
  on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): void;
  hrtime: { bigint(): bigint };
};

declare module 'node:stream' {
  class Duplex {
    on(event: 'data', listener: (chunk: Buffer) => void): this;
    on(event: 'close' | 'end', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    write(data: Uint8Array | string): boolean;
    end(data?: Uint8Array | string): this;
    destroy(): this;
  }
}

declare module 'node:net' {
  import { Duplex } from 'node:stream';
  class Socket extends Duplex {
    remoteAddress?: string;
    setNoDelay(noDelay?: boolean): this;
  }
}

declare module 'node:http' {
  import type { Socket } from 'node:net';
  import type { Duplex } from 'node:stream';
  class IncomingMessage {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    socket: Socket;
  }
  class ServerResponse {
    writeHead(status: number, headers?: Record<string, string>): this;
    end(body?: Uint8Array | string): this;
  }
  class Server {
    on(event: 'upgrade', listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    listen(port: number, host: string, callback?: () => void): this;
    address(): { port: number; address: string } | string | null;
    close(callback?: () => void): this;
  }
  function createServer(handler?: (req: IncomingMessage, res: ServerResponse) => void): Server;
}

declare module 'node:crypto' {
  interface Hash { update(data: string): Hash; digest(encoding: 'base64' | 'hex'): string }
  function createHash(algorithm: 'sha1' | 'sha256'): Hash;
}

declare module 'node:fs/promises' {
  function readFile(path: string): Promise<Buffer>;
  function stat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean }>;
}

declare module 'node:path' {
  const sep: string;
  function extname(p: string): string;
  function join(...parts: string[]): string;
  function normalize(p: string): string;
  function resolve(...parts: string[]): string;
}

declare module 'node:os' {
  function networkInterfaces(): Record<string, { address: string; family: string | number; internal: boolean }[] | undefined>;
}

declare module 'node:child_process' {
  function execFile(
    file: string, args: readonly string[], options: { timeout?: number },
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ): unknown;
}

declare module 'node:url' {
  function fileURLToPath(url: string | URL): string;
}
