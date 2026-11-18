// One configured command. Each entry belongs to a single hub (or to all hubs when hub_url is empty)
export interface HubCommand {
  hub_url?: string | null;
  more_hubs?: string | null;
  // Menus where the command is shown (missing = both)
  placement?: 'user' | 'hub' | 'both';
  name: string;
  text: string;
  third_person?: boolean;
  icon?: string | null;
}

export interface HubSession {
  id: number;
  hub_url: string;
}

export interface HubUser {
  id: number;
  nick: string;
}

// Item of the hub message list (either of the fields is set)
export interface HubMessageItem {
  chat_message?: { from?: HubUser };
  status_message?: object;
}

export interface Logger {
  error: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  info: (...args: any[]) => void;
  verbose: (...args: any[]) => void;
}

export const enum SeverityEnum {
  NOTIFY = 'notify',
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
}
