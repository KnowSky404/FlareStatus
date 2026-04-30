export type SqlValue =
  | string
  | number
  | boolean
  | null
  | Date
  | Uint8Array
  | Record<string, unknown>
  | readonly SqlValue[];

export interface SqlConnection {
  unsafe<T = unknown>(
    query: string,
    params?: readonly SqlValue[],
  ): Promise<T>;
  begin<T>(callback: (tx: SqlConnection) => Promise<T>): Promise<T>;
  close?(options?: { timeout?: number }): Promise<void>;
}

export function executeSql<T = unknown>(
  connection: Pick<SqlConnection, "unsafe">,
  query: string,
  params: readonly SqlValue[] = [],
): Promise<T> {
  return connection.unsafe<T>(query, params.length > 0 ? params : undefined);
}

export function withTransaction<T>(
  connection: Pick<SqlConnection, "begin">,
  callback: (tx: SqlConnection) => Promise<T>,
): Promise<T> {
  return connection.begin((tx) => callback(tx as SqlConnection));
}
