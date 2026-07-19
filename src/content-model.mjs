const METADATA_FIELDS = [
  'vod_time',
  'vod_time_add',
  'vod_pubdate',
  'vod_total',
  'vod_serial',
  'vod_duration',
];

export const PRIMARY_CATEGORIES = Object.freeze([
  'theatrical_movie',
  'web_movie',
  'other_movie',
  'tv_series',
  'web_series',
  'web_short',
  'variety',
  'anime',
  'documentary',
  'explainer',
  'knowledge',
  'adult',
]);

export const DERIVED_VIEW_CATEGORIES = Object.freeze(['recommend']);

const CATEGORY_SET = new Set(PRIMARY_CATEGORIES);
const SOURCE_ID_FIELDS = [
  'source_category_id',
  'sourceCategoryId',
  'type_id',
  'category_id',
  'categoryId',
];
const EXPLICIT_TAG_FIELDS = [
  'explicit_tags',
  'explicitTags',
  'tags',
  'semantic_tags',
  'semanticTags',
  'vod_tag',
  'vod_tags',
  'vod_class',
];
const DETAIL_FIELDS = [
  'type_name',
  'typeName',
  'source_category_name',
  'sourceCategoryName',
  'content_type',
  'contentType',
  'format',
  'genre',
  'vod_sub',
  'vod_remarks',
  'vod_state',
  'vod_area',
  'vod_lang',
  'vod_content',
  'vod_play_from',
  'vod_serial',
  'release_type',
  'release_channel',
  'movie_release_channel',
  'distribution_channel',
  'content_format',
  'short_form',
];
const TITLE_FIELDS = ['vod_name', 'title', 'name'];
const CHANNEL_FIELDS = [
  'release_channel',
  'movie_release_channel',
  'distribution_channel',
  'release_type',
];
const EPISODE_FIELDS = [
  'episode_count',
  'episodes',
  'total_episodes',
  'series_count',
  'episode_total',
  'vod_total',
  'vod_serial',
];
const DURATION_FIELDS = [
  'episode_duration_minutes',
  'duration_minutes',
  'vod_duration',
  'episode_duration',
  'duration',
];

const SOURCE_PRIORITY = Object.freeze({
  source_category_id: 1,
  explicit_tags: 2,
  detail_metadata: 3,
  duration_episode: 4,
  weak_title: 5,
  episode_evidence: 6,
  fallback: 7,
});

const CONFIDENCE = Object.freeze({
  source_category_id: { level: 'high', score: 0.99 },
  explicit_tags: { level: 'high', score: 0.94 },
  detail_metadata: { level: 'medium', score: 0.82 },
  duration_episode: { level: 'medium', score: 0.78 },
  weak_title: { level: 'low', score: 0.55 },
  episode_evidence: { level: 'low', score: 0.48 },
  fallback: { level: 'low', score: 0.2 },
});

const SPECIFIC_RULES = [
  { category: 'adult', pattern: /\u6210\u4eba|\u8272\u60c5|\u4f26\u7406|\u798f\u5229|\u5199\u771f|\u4e09\u7ea7|18\s*\u7981|\badult\b|\bxxx\b/iu },
  { category: 'web_short', pattern: /\u5fae\u77ed\u5267|\u7f51\u7edc\u77ed\u5267|\u7ad6\u5c4f\u77ed\u5267|\u77ed\u5267|\u723d\u6587|\u53cd\u8f6c\u723d|\u5973\u9891\u604b\u7231|\u5973\u604b\u603b\u88c1|\bshort[\s-]*form\b|\bmicro[\s-]*drama\b|\bvertical[\s-]*drama\b/iu },
  { category: 'web_series', pattern: /\u7f51\u7edc\u5267|\u7f51\u5267|\bweb[\s-]*series\b|\bonline[\s-]*series\b|\bstreaming[\s-]*series\b|\bweb[\s-]*drama\b/iu },
  { category: 'theatrical_movie', pattern: /\u9662\u7ebf(?:\u7535\u5f71|\u7247)?|\u5f71\u9662\u4e0a\u6620|\u9662\u7ebf\u4e0a\u6620|\btheatrical\b|\bcinema[\s-]*release\b/iu },
  { category: 'web_movie', pattern: /\u7f51\u7edc(?:\u5927)?\u7535\u5f71|\u7f51\u5927|\bonline[\s-]*movie\b|\bweb[\s-]*movie\b|\bstreaming[\s-]*film\b/iu },
  { category: 'explainer', pattern: /\u5f71\u89c6\u89e3\u8bf4|\u7535\u5f71\u89e3\u8bf4|\u89e3\u8bf4|\bexplainer\b|\bmovie[\s-]*recap\b/iu },
  { category: 'documentary', pattern: /\u7eaa\u5f55\u7247|\u7eaa\u5b9e|\bdocumentary\b|\bdocuseries\b/iu },
  { category: 'variety', pattern: /\u7efc\u827a|\u771f\u4eba\u79c0|\u8131\u53e3\u79c0|\u665a\u4f1a|\bvariety\b|\breality[\s-]*show\b|\btalk[\s-]*show\b/iu },
  { category: 'anime', pattern: /\u52a8\u6f2b|\u52a8\u753b(?:\u7247|\u5267\u96c6)?|\u756a\u5267|\banime\b|\banimation\b/iu },
  { category: 'knowledge', pattern: /\u77e5\u8bc6|\u516c\u5f00\u8bfe|\u6559\u7a0b|\u8bb2\u5ea7|\u79d1\u666e|\u79d1\u6280|\u5b9e\u9a8c|\u5b87\u5b99|\u81ea\u7136|\u6f14\u5531\u4f1a|\u97f3\u4e50\u4f1a|\u97f3\u4e50\u8282|\u5de1\u6f14|\bLIVE\b|\bMV\b|\u73b0\u573a|\u665a\u4f1a|\u4f53\u80b2|\u8d5b\u4e8b|\u6bd4\u8d5b|\u8db3\u7403|\u7bee\u7403|\u683c\u6597|\u513f\u6b4c|\u65e9\u6559|\u4eb2\u5b50|\u5c11\u513f|\u65b0\u95fb|\u8d44\u8baf|\u8bbf\u8c08|\u8d22\u7ecf|\u5546\u4e1a|\u6295\u8d44|\u521b\u4e1a|\u6e38\u620f|\u6d4b\u8bc4|\u65c5\u884c|\u7f8e\u98df|\u5065\u8eab|\u751f\u6d3b|vlog|\bknowledge\b|\btutorial\b|\bcourse\b|\blecture\b/iu },
];
const EXPLICIT_TV_RULES = [
  { category: 'tv_series', pattern: /\u7535\u89c6\u5267|\u7535\u89c6\u8fde\u7eed\u5267|\u8fde\u7eed\u5267|\btv[\s-]*series\b/iu },
];
const GENERIC_MOVIE_RULES = [
  { category: 'movie', pattern: /\u7535\u5f71|\u5f71\u7247|\bmovie\b|\bfilm\b|\bfeature[\s-]*film\b/iu },
];
const GENERIC_SERIES_RULES = [
  { category: 'series', pattern: /\u5267\u96c6|\u7535\u89c6\u5267|\u8fde\u7eed\u5267|\bseries\b|\bdrama\b|\bshow\b/iu },
];
const THEATRICAL_CHANNEL_PATTERN = /\u9662\u7ebf|\u5f71\u9662|\btheatrical\b|\bcinema/iu;
const WEB_MOVIE_CHANNEL_PATTERN = /\u7f51\u7edc(?:\u5927)?\u7535\u5f71|\u7f51\u5927|\bonline[\s-]*movie\b|\bweb[\s-]*movie\b|\bstreaming[\s-]*film\b/iu;

const SOURCE_CLASS_RULES = [
  ['adult', /\u4f26\u7406|\u798f\u5229|\u6210\u4eba|\u5199\u771f|\u4e09\u7ea7|\u8272\u60c5|\bxxx\b/iu],
  ['explainer', /\u89e3\u8bf4|\u5f71\u8bc4|\u76d8\u70b9|\u8bb2\u89e3/iu],
  ['web_short', /\u77ed\u5267|\u5fae\u77ed\u5267|\u723d\u6587|\u53cd\u8f6c\u723d|\u5973\u9891\u604b\u7231|\u5973\u604b\u603b\u88c1|\u7ad6\u5c4f|\bAI\s*\u6f2b\u5267\b/iu],
  ['documentary', /\u7eaa\u5f55|\u7eaa\u5b9e|\u8bb0\u5f55/iu],
  ['anime', /\u52a8\u6f2b|\u52a8\u753b|\u5361\u901a|\u756a\u5267|\u6f2b\u5267/iu],
  ['variety', /\u7efc\u827a|\u771f\u4eba\u79c0|\u8131\u53e3\u79c0|\u665a\u4f1a/iu],
  ['knowledge', /\u6f14\u5531\u4f1a|\u97f3\u4e50|\u4f53\u80b2|\u8d5b\u4e8b|\u6bd4\u8d5b|\u8db3\u7403|\u7bee\u7403|\u9884\u544a|\u65b0\u95fb|\u8d44\u8baf|\u77e5\u8bc6|\u516c\u5f00\u8bfe|\u6559\u7a0b|\u8bb2\u5ea7|\u79d1\u666e|\u6e38\u620f|\u6d4b\u8bc4|\u65c5\u884c|\u7f8e\u98df|\u5065\u8eab|\u751f\u6d3b|vlog|\bLIVE\b|\bMV\b/iu],
  ['web_series', /\u7f51\u7edc\u5267|\u7f51\u5267|\u7f51\u7edc\u7535\u89c6\u5267|\u5e73\u53f0\u72ec\u64ad/iu],
  ['tv_series', /\u7535\u89c6\u5267|\u8fde\u7eed\u5267|\u56fd\u4ea7\u5267|\u5927\u9646\u5267|\u7f8e\u5267|\u82f1\u5267|\u6e2f\u5267|\u53f0\u5267|\u97e9\u5267|\u65e5\u5267|\u6cf0\u5267|\u5267\u96c6/iu],
  ['theatrical_movie', /\u9662\u7ebf|\u5f71\u9662\u4e0a\u6620|\btheatrical\b|\bcinema/iu],
  ['web_movie', /\u7f51\u7edc\u7535\u5f71|\u7f51\u5927|\u7f51\u7edc\u9996\u53d1|\bonline[\s-]*movie\b|\bweb[\s-]*movie\b/iu],
  ['other_movie', /\u7535\u5f71|\u5f71\u7247|\u52a8\u4f5c\u7247|\u559c\u5267\u7247|\u7231\u60c5\u7247|\u79d1\u5e7b\u7247|\u6050\u6016\u7247|\u5267\u60c5\u7247/iu],
];

const DIRECT_EXTERNAL_FIELDS = [
  ['imdb', 'imdb_id'],
  ['tmdb', 'tmdb_id'],
  ['douban', 'douban_id'],
  ['douban', 'vod_douban_id'],
  ['tvdb', 'tvdb_id'],
  ['bangumi', 'bangumi_id'],
  ['mal', 'mal_id'],
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function classifySourceCategoryName(value) {
  const normalized = normalizeText(value).replace(/[\s/]+/gu, '');
  if (!normalized) return '';
  return SOURCE_CLASS_RULES.find(([, pattern]) => pattern.test(normalized))?.[0] || '';
}

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

function normalizeCategory(value) {
  return normalizeText(value).toLowerCase().replace(/[\s-]+/gu, '_');
}

function valuesForField(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => valuesForField(entry));
  if (isRecord(value)) return Object.values(value).flatMap((entry) => valuesForField(entry));
  return [value];
}

function makeEntries(item, fields) {
  return fields.flatMap((field) => valuesForField(item[field])
    .map((value) => ({ field, value: normalizeText(value) }))
    .filter((entry) => entry.value));
}

function findMatch(entries, rules) {
  for (const rule of rules) {
    for (const entry of entries) {
      const match = entry.value.match(rule.pattern);
      if (match) return { ...rule, entry, match: match[0] };
    }
  }
  return null;
}

function mapValue(map, key) {
  if (map instanceof Map) return map.get(key);
  if (isRecord(map) && Object.prototype.hasOwnProperty.call(map, key)) return map[key];
  return undefined;
}

function sourceCategory(item, options) {
  const maps = [
    options?.sourceCategoryMap,
    options?.source_category_map,
    item.sourceCategoryMap,
    item.source_category_map,
  ];

  for (const field of SOURCE_ID_FIELDS) {
    const id = normalizeText(item[field]);
    if (!id) continue;
    let mapped;
    for (const map of maps) {
      mapped = mapValue(map, id);
      if (mapped !== undefined) break;
    }
    const mappedCategory = isRecord(mapped)
      ? (mapped.primary_category ?? mapped.category)
      : mapped;
    const category = normalizeCategory(mappedCategory ?? id);
    if (CATEGORY_SET.has(category)) {
      return { category, field, value: id, match: mappedCategory ?? id };
    }
  }
  return null;
}

function makeEvidence(source, category, match, extra = {}) {
  return {
    source,
    priority: SOURCE_PRIORITY[source],
    category,
    field: match?.entry?.field ?? extra.field ?? '',
    value: match?.entry?.value ?? extra.value ?? '',
    signal: match?.match ?? extra.signal ?? category,
    ...extra,
  };
}

function movieChannelFromValue(value) {
  const normalized = normalizeCategory(value);
  if (normalized === 'theatrical' || normalized === 'cinema' || normalized === 'theatrical_release') return 'theatrical';
  if (normalized === 'web' || normalized === 'online' || normalized === 'streaming' || normalized === 'web_release') return 'web';

  const text = normalizeText(value);
  if (THEATRICAL_CHANNEL_PATTERN.test(text)) return 'theatrical';
  if (WEB_MOVIE_CHANNEL_PATTERN.test(text)) return 'web';
  return 'unknown';
}

function channelFromEntries(entries, allowBare) {
  for (const entry of entries) {
    if (CHANNEL_FIELDS.includes(entry.field)) {
      const channel = movieChannelFromValue(entry.value);
      if (channel !== 'unknown') return { channel, entry };
    }
  }
  for (const entry of entries) {
    if (THEATRICAL_CHANNEL_PATTERN.test(entry.value)) return { channel: 'theatrical', entry };
    if (WEB_MOVIE_CHANNEL_PATTERN.test(entry.value)) return { channel: 'web', entry };
    if (allowBare && /\b(?:web|online|streaming)\b/iu.test(entry.value)) return { channel: 'web', entry };
  }
  return { channel: 'unknown', entry: null };
}

function movieCategoryForChannel(channel) {
  if (channel === 'theatrical') return 'theatrical_movie';
  if (channel === 'web') return 'web_movie';
  return 'other_movie';
}

function channelForCategory(category) {
  if (category === 'theatrical_movie') return 'theatrical';
  if (category === 'web_movie') return 'web';
  return 'unknown';
}

function makeClassification(category, source, evidences, movieChannel = 'unknown') {
  const confidence = CONFIDENCE[source] ?? CONFIDENCE.fallback;
  const sortedEvidence = [...evidences].sort((a, b) => a.priority - b.priority);
  return {
    primary_category: category,
    movie_release_channel: category === 'theatrical_movie' || category === 'web_movie' || category === 'other_movie'
      ? (movieChannel === 'unknown' ? channelForCategory(category) : movieChannel)
      : 'unknown',
    classification_evidence: sortedEvidence,
    classification_confidence: confidence.score,
    classification_confidence_level: confidence.level,
    classification_confidence_score: confidence.score,
  };
}

function classifyMatched(category, source, match, extra = {}) {
  return makeClassification(category, source, [makeEvidence(source, category, match, extra)]);
}

function classifyMovieMatch(match, source, tagEntries, detailEntries) {
  const sameLayerEntries = source === 'explicit_tags' ? tagEntries : detailEntries;
  let channelResult = channelFromEntries(sameLayerEntries, source === 'explicit_tags');
  if (channelResult.channel === 'unknown' && source === 'explicit_tags') {
    channelResult = channelFromEntries(detailEntries, false);
  }
  const category = movieCategoryForChannel(channelResult.channel);
  const evidences = [makeEvidence(source, category, match)];
  if (channelResult.entry && (
    channelResult.entry.field !== match.entry.field
    || source !== (tagEntries.includes(channelResult.entry) ? 'explicit_tags' : 'detail_metadata')
    || channelResult.entry.value !== match.entry.value
  )) {
    const channelSource = tagEntries.includes(channelResult.entry) ? 'explicit_tags' : 'detail_metadata';
    evidences.push(makeEvidence(channelSource, category, channelResult, {
      signal: channelResult.channel,
      value: channelResult.entry.value,
    }));
  }
  return makeClassification(category, source, evidences, channelResult.channel);
}

function parseNumber(value) {
  const text = normalizeText(value).replace(/,/gu, '');
  if (!text || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/u.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function parseEpisodeCount(value) {
  const direct = parseNumber(value);
  if (direct !== null && direct > 0) return direct;
  const text = normalizeText(value);
  const match = text.match(/(?:\u5168|\u5171|\u66f4\u65b0\u81f3|\u81f3)?\s*(\d{1,4})\s*(?:\u96c6|episodes?|eps?|ep\b)/iu);
  return match ? Number(match[1]) : null;
}

function extractEpisodeEvidence(item) {
  for (const field of EPISODE_FIELDS) {
    for (const value of valuesForField(item[field])) {
      const count = parseEpisodeCount(value);
      if (count !== null && count > 0) return { count, field, value: normalizeText(value) };
    }
  }
  for (const field of ['vod_remarks', 'vod_content', 'vod_state']) {
    for (const value of valuesForField(item[field])) {
      const count = parseEpisodeCount(value);
      if (count !== null && count > 0) return { count, field, value: normalizeText(value) };
    }
  }
  return null;
}

function parseDurationMinutes(value) {
  const direct = parseNumber(value);
  if (direct !== null && direct >= 0) return direct;
  const text = normalizeText(value).toLowerCase();
  if (!text) return null;

  const clock = text.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/u);
  if (clock) {
    const first = Number(clock[1]);
    const second = Number(clock[2]);
    const third = clock[3] === undefined ? null : Number(clock[3]);
    return third === null ? first + second / 60 : first * 60 + second + third / 60;
  }

  const iso = text.match(/^pt(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/iu);
  if (iso) {
    return Number(iso[1] || 0) * 60 + Number(iso[2] || 0) + Number(iso[3] || 0) / 60;
  }

  const hours = text.match(/(\d+(?:\.\d+)?)\s*(?:\u5c0f\u65f6|h)/iu);
  const minutes = text.match(/(\d+(?:\.\d+)?)\s*(?:\u5206\u949f|\u5206|min(?:ute)?s?)/iu);
  const seconds = text.match(/(\d+(?:\.\d+)?)\s*(?:\u79d2|sec(?:ond)?s?)/iu);
  if (hours || minutes || seconds) {
    return Number(hours?.[1] || 0) * 60
      + Number(minutes?.[1] || 0)
      + Number(seconds?.[1] || 0) / 60;
  }
  return null;
}

function extractDurationEvidence(item) {
  for (const field of DURATION_FIELDS) {
    for (const value of valuesForField(item[field])) {
      const minutes = parseDurationMinutes(value);
      if (minutes !== null) return { minutes, field, value: normalizeText(value) };
    }
  }
  return null;
}

function classifyDurationAndEpisode(duration, episode) {
  if (duration && episode && duration.minutes <= 15 && episode.count >= 20) {
    return makeClassification(
      'web_short',
      'duration_episode',
      [makeEvidence('duration_episode', 'web_short', null, {
        field: duration.field + '+' + episode.field,
        value: duration.value + ' + ' + episode.value,
        signal: 'duration<=15min and episodes>=20',
      })],
    );
  }
  if (duration && episode && duration.minutes > 15 && episode.count >= 2) {
    return makeClassification(
      'tv_series',
      'duration_episode',
      [makeEvidence('duration_episode', 'tv_series', null, {
        field: duration.field + '+' + episode.field,
        value: duration.value + ' + ' + episode.value,
        signal: 'long-form series evidence',
      })],
    );
  }
  return null;
}

function normalizeIdentityText(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

function normalizeExternalIdentity(provider, value) {
  const raw = normalizeText(value).toLowerCase();
  if (!raw || /^(?:0+|null|none|unknown|undefined|n\/a|na)$/u.test(raw)) return '';
  const normalized = normalizeIdentityText(value);
  if (!normalized) return '';
  if (['douban', 'tmdb', 'tvdb', 'bangumi', 'mal'].includes(provider) && /^0+$/u.test(normalized)) return '';
  return normalized;
}

function firstValue(item, fields) {
  for (const field of fields) {
    const values = valuesForField(item[field]);
    for (const value of values) {
      const text = normalizeText(value);
      if (text) return text;
    }
  }
  return '';
}

function normalizeYear(item) {
  const value = firstValue(item, ['year', 'vod_year', 'vod_pubdate', 'publication_year']);
  const match = value.match(/(?:19|20)\d{2}/u);
  return match ? match[0] : normalizeIdentityText(value);
}

function parseSeason(value) {
  const text = normalizeText(value);
  const direct = parseNumber(text);
  if (direct !== null && direct >= 0) return String(Math.trunc(direct));
  const match = text.match(/(?:\u7b2c\s*)?(\d{1,3})\s*(?:\u5b63|season)|\bs(\d{1,3})\b/iu);
  return match ? String(Number(match[1] ?? match[2])) : '';
}

function normalizeSeason(item, title) {
  const explicit = firstValue(item, ['season', 'vod_season', 'season_number']);
  const fromExplicit = parseSeason(explicit);
  if (fromExplicit) return fromExplicit;
  return parseSeason(title);
}

function creatorParts(item) {
  const fields = [
    'creators',
    'creator',
    'directors',
    'director',
    'vod_director',
    'writers',
    'writer',
    'vod_writer',
    'producers',
    'producer',
  ];
  const parts = [];
  for (const field of fields) {
    for (const value of valuesForField(item[field])) {
      for (const part of normalizeText(value).split(/[,\u3001/|;]+/u)) {
        const normalized = normalizeIdentityText(part);
        if (normalized) parts.push(normalized);
      }
    }
  }
  return [...new Set(parts)].sort();
}

function externalId(item) {
  const external = item.external_ids ?? item.externalIds;
  if (isRecord(external)) {
    const normalizedExternal = new Map();
    for (const key of Object.keys(external).sort()) {
      const provider = normalizeCategory(key);
      if (provider && !normalizedExternal.has(provider)) normalizedExternal.set(provider, external[key]);
    }
    const keys = [...normalizedExternal.keys()];
    const priority = [
      ...DIRECT_EXTERNAL_FIELDS.map(([provider]) => provider),
      ...keys.map((key) => normalizeCategory(key)).filter((key) => !DIRECT_EXTERNAL_FIELDS.some(([provider]) => provider === key)).sort(),
    ];
    for (const provider of priority) {
      const value = normalizedExternal.get(provider);
      const normalized = normalizeExternalIdentity(provider, value);
      if (normalized) return { provider, value: normalized };
    }
  }

  for (const [provider, field] of DIRECT_EXTERNAL_FIELDS) {
    const value = firstValue(item, [field]);
    const normalized = normalizeExternalIdentity(provider, value);
    if (normalized) return { provider, value: normalized };
  }

  const genericValue = firstValue(item, ['external_id', 'externalId']);
  if (genericValue) {
    const provider = normalizeCategory(firstValue(item, ['external_id_source', 'externalIdSource', 'external_provider']) || 'generic');
    const normalized = normalizeExternalIdentity(provider || 'generic', genericValue);
    if (normalized) return { provider: provider || 'generic', value: normalized };
  }
  return null;
}

export function buildCanonicalId(item = {}) {
  const input = isRecord(item) ? item : {};
  const external = externalId(input);
  if (external) return 'ext:' + external.provider + ':' + encodeURIComponent(external.value);

  const title = firstValue(input, TITLE_FIELDS);
  const normalizedTitle = normalizeIdentityText(title) || 'untitled';
  const year = normalizeYear(input) || 'unknown';
  const season = normalizeSeason(input, title) || '0';
  const creators = creatorParts(input).join(',');
  return 'meta:' + [normalizedTitle, year, season, creators || 'unknown']
    .map((part) => encodeURIComponent(part))
    .join(':');
}

function fallbackEvidence(category) {
  return makeEvidence('fallback', category, null, {
    field: 'none',
    value: 'no stronger classification signal',
    signal: category,
  });
}

function genericSourceOverride(source, tags, details) {
  if (!source || (source.category !== 'other_movie' && source.category !== 'tv_series')) return null;

  const allowed = source.category === 'other_movie'
    ? new Set(['theatrical_movie', 'web_movie'])
    : new Set(['web_series']);
  const specificRules = SPECIFIC_RULES.filter((rule) => allowed.has(rule.category));
  const tagSpecific = findMatch(tags, specificRules);
  if (tagSpecific) return classifyMatched(tagSpecific.category, 'explicit_tags', tagSpecific);
  const detailSpecific = findMatch(details, specificRules);
  if (detailSpecific) return classifyMatched(detailSpecific.category, 'detail_metadata', detailSpecific);

  if (source.category === 'other_movie') {
    const detailChannel = channelFromEntries(details, false);
    if (detailChannel.channel !== 'unknown') {
      const category = movieCategoryForChannel(detailChannel.channel);
      return makeClassification(
        category,
        'detail_metadata',
        [makeEvidence('detail_metadata', category, detailChannel, {
          signal: detailChannel.channel,
        })],
        detailChannel.channel,
      );
    }
  }
  return null;
}

export function classifyContent(item = {}, options = {}) {
  const input = isRecord(item) ? item : {};
  const tags = makeEntries(input, EXPLICIT_TAG_FIELDS);
  const details = makeEntries(input, DETAIL_FIELDS);
  const titles = makeEntries(input, TITLE_FIELDS);

  const source = sourceCategory(input, options);
  if (source) {
    const override = genericSourceOverride(source, tags, details);
    if (override) return override;
    return makeClassification(
      source.category,
      'source_category_id',
      [makeEvidence('source_category_id', source.category, {
        entry: { field: source.field, value: source.value },
        match: source.match,
      })],
    );
  }

  const tagSpecific = findMatch(tags, SPECIFIC_RULES);
  if (tagSpecific) return classifyMatched(tagSpecific.category, 'explicit_tags', tagSpecific);
  const tagTv = findMatch(tags, EXPLICIT_TV_RULES);
  if (tagTv) return classifyMatched('tv_series', 'explicit_tags', tagTv);
  const tagMovie = findMatch(tags, GENERIC_MOVIE_RULES);
  const tagSeries = findMatch(tags, GENERIC_SERIES_RULES);
  if (tagMovie) return classifyMovieMatch(tagMovie, 'explicit_tags', tags, details);

  const detailSpecific = findMatch(details, SPECIFIC_RULES);
  if (detailSpecific) return classifyMatched(detailSpecific.category, 'detail_metadata', detailSpecific);
  const detailTv = findMatch(details, EXPLICIT_TV_RULES);
  if (detailTv) return classifyMatched('tv_series', 'detail_metadata', detailTv);
  const detailMovie = findMatch(details, GENERIC_MOVIE_RULES);
  const detailSeries = findMatch(details, GENERIC_SERIES_RULES);
  if (detailMovie) return classifyMovieMatch(detailMovie, 'detail_metadata', tags, details);

  const detailChannel = channelFromEntries(details, false);
  if (detailChannel.channel !== 'unknown') {
    const category = movieCategoryForChannel(detailChannel.channel);
    return makeClassification(
      category,
      'detail_metadata',
      [makeEvidence('detail_metadata', category, detailChannel, {
        signal: detailChannel.channel,
      })],
      detailChannel.channel,
    );
  }

  const duration = extractDurationEvidence(input);
  const episode = extractEpisodeEvidence(input);
  const durationClassification = classifyDurationAndEpisode(duration, episode);
  if (durationClassification) return durationClassification;

  const titleSpecific = findMatch(titles, [...SPECIFIC_RULES, ...EXPLICIT_TV_RULES]);
  if (titleSpecific) {
    const category = titleSpecific.category === 'tv_series' ? 'tv_series' : titleSpecific.category;
    return classifyMatched(category, 'weak_title', titleSpecific);
  }
  const titleMovie = findMatch(titles, GENERIC_MOVIE_RULES);
  if (titleMovie) return classifyMovieMatch(titleMovie, 'weak_title', titles, details);
  const titleSeries = findMatch(titles, GENERIC_SERIES_RULES);
  if (titleSeries) return classifyMatched('tv_series', 'weak_title', titleSeries);

  if (episode && episode.count >= 2) {
    return makeClassification(
      'tv_series',
      'episode_evidence',
      [makeEvidence('episode_evidence', 'tv_series', null, {
        field: episode.field,
        value: episode.value,
        signal: 'episode-count=' + episode.count,
      })],
    );
  }
  if (tagSeries || detailSeries) {
    const match = tagSeries ?? detailSeries;
    const sourceName = tagSeries ? 'explicit_tags' : 'detail_metadata';
    return classifyMatched('tv_series', sourceName, match);
  }

  return makeClassification('other_movie', 'fallback', [fallbackEvidence('other_movie')]);
}

export function classifyPrimaryCategory(item = {}, options = {}) {
  return classifyContent(item, options).primary_category;
}

export function normalizeContentItem(item = {}, options = {}) {
  const input = isRecord(item) ? item : {};
  const normalized = { ...input };
  for (const field of METADATA_FIELDS) normalized[field] = normalizeText(input[field]);
  return {
    ...normalized,
    canonical_id: buildCanonicalId(normalized),
    ...classifyContent(normalized, options),
  };
}

export const createCanonicalId = buildCanonicalId;
export const normalizeContent = normalizeContentItem;

export default Object.freeze({
  DERIVED_VIEW_CATEGORIES,
  PRIMARY_CATEGORIES,
  buildCanonicalId,
  classifyContent,
  classifyPrimaryCategory,
  classifySourceCategoryName,
  normalizeContentItem,
});
