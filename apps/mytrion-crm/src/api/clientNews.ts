/** /v1/client-news — admin authoring for the mini-app's news feed (see ClientNews.tsx). */
import { request } from './transport';

export interface NewsLocalized {
  en: string;
  ru?: string;
  uz?: string;
  es?: string;
}

export interface ClientNewsPost {
  id: string;
  title: NewsLocalized;
  body: NewsLocalized;
  audienceScope: 'all' | 'carriers';
  carrierIds: string[];
  roles: Array<'owner' | 'driver'>;
  severity: 'info' | 'important';
  pinned: boolean;
  publishAt: string;
  expiresAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface CreateClientNewsInput {
  title: NewsLocalized;
  body: NewsLocalized;
  audience_scope: 'all' | 'carriers';
  carrier_ids: string[];
  roles: Array<'owner' | 'driver'>;
  severity: 'info' | 'important';
  pinned: boolean;
}

export async function listClientNews(): Promise<ClientNewsPost[]> {
  return (await request('GET', '/client-news')) as ClientNewsPost[];
}

export async function createClientNews(input: CreateClientNewsInput): Promise<ClientNewsPost> {
  return (await request('POST', '/client-news', { body: input })) as ClientNewsPost;
}
