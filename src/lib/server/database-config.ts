export interface CachedDatabaseClient<TClient> {
  connectionString: string;
  client: TClient;
}

export interface CachedClientResult<TClient> {
  cache: CachedDatabaseClient<TClient>;
  client: TClient;
  replaced?: TClient;
}

/** Returns null when the optional runtime URL is absent; rejects non-Postgres URLs. */
export function normalizeDatabaseUrl(value: string | undefined): string | null {
  const connectionString = value?.trim();
  if (!connectionString) return null;

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }

  if (
    databaseUrl.protocol !== "postgresql:" &&
    databaseUrl.protocol !== "postgres:"
  ) {
    throw new Error("DATABASE_URL must use the PostgreSQL protocol.");
  }

  return connectionString;
}

/** Reuses a client for a warm process, recreating it only when the URL changes. */
export function getOrCreateCachedClient<TClient>(
  current: CachedDatabaseClient<TClient> | undefined,
  connectionString: string,
  create: () => TClient,
): CachedClientResult<TClient> {
  if (current?.connectionString === connectionString) {
    return { cache: current, client: current.client };
  }

  const client = create();
  return {
    cache: { connectionString, client },
    client,
    ...(current ? { replaced: current.client } : {}),
  };
}
