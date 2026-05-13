import type { RoboRequest } from '@robojs/server';
import type { ActivitySession } from '@/lib/activity-types';
import { makeSessionKey, asSingleString, nowIso, jsonResponse, optionsResponse } from '../../lib/activity-utils';
import { redisGetJson, redisSetJson } from '@/lib/upstash';

const DEFAULT_CHANNELS_URL = 'https://benfica-sempre-m3u.benficasempretv20260311.workers.dev/device-m3u/discord-a0410a3281b84c0ea34f34a196c85ec6.m3u';
const SESSION_TTL_SEC = 3600;

export default async (req: RoboRequest) => {
  if (req.method === 'OPTIONS') return optionsResponse();
  
  if (req.method === 'POST') {
    const { guildId, voiceChannelId, channelsUrl } = await req.json();
    if (!guildId || !voiceChannelId || !channelsUrl) {
      return jsonResponse({ ok: false, error: 'missing_fields' }, 400);
    }
    
    const key = makeSessionKey(guildId, voiceChannelId);
    const timestamp = nowIso();
    const session: ActivitySession = {
      guildId,
      voiceChannelId,
      channelsUrl,
      source: 'manual_update',
      activeChannelUrl: '',
      activeChannelName: '',
      activeUpdatedAt: timestamp,
      updatedAt: timestamp,
      activeMutationId: '',
      activeUpdatedBy: ''
    };
    
    await redisSetJson(key, session, SESSION_TTL_SEC);
    return jsonResponse({ ok: true, session });
  }

  if (req.method !== 'GET') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);

  const guildId = asSingleString(req.query.guildId as string | string[] | undefined).trim();
  const voiceChannelId = asSingleString(req.query.voiceChannelId as string | string[] | undefined).trim();

  if (!guildId || !voiceChannelId) {
    return jsonResponse({ ok: false, error: 'missing_guild_or_voice' }, 400);
  }

  const key = makeSessionKey(guildId, voiceChannelId);
  const existing = await redisGetJson<ActivitySession>(key);
  if (existing) return jsonResponse({ ok: true, session: existing });

  const timestamp = nowIso();
  const channelsUrl = String(process.env.CHANNELS_URL || '').trim() || DEFAULT_CHANNELS_URL;
  const created: ActivitySession = {
    guildId,
    voiceChannelId,
    channelsUrl,
    source: 'auto_created',
    activeChannelUrl: '',
    activeChannelName: '',
    activeUpdatedAt: timestamp,
    updatedAt: timestamp,
    activeMutationId: '',
    activeUpdatedBy: ''
  };

  await redisSetJson(key, created, SESSION_TTL_SEC);
  return jsonResponse({ ok: true, session: created });
};