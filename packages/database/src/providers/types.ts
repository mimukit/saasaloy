export interface DatabaseProvider<TClient = unknown> {
  readonly name: string;
  readonly client: TClient;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}
