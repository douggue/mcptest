/**
 * Turns the source an "Add to format" button names into an ingredient, by
 * reading that source from the store. A source that is not there is refused
 * in plain words; nothing is made up to fill its place.
 */
import {
  ingredientFromBreakdownPart,
  ingredientFromClip,
  ingredientFromFormula,
  ingredientFromHook,
  ingredientFromImage,
  ingredientFromNiche,
  ingredientFromNote,
  ingredientFromTeardown,
  ingredientFromTransferFormat,
  ingredientFromTransferIdea,
  ingredientFromUnreadLink,
  ingredientFromVideo,
  type IngredientDraft,
} from '@jgtube/core';
import { randomUUID } from 'node:crypto';
import type { FormatSources, IngredientRequest } from './formatTypes';

/** A draft, or why there is none. */
export type Resolved = IngredientDraft | { readonly missing: string };

const missing = (text: string): Resolved => ({ missing: text });

type Of<K extends IngredientRequest['kind']> = Extract<IngredientRequest, { kind: K }>;

function formula(sources: FormatSources, request: Of<'formula'>): Resolved {
  const list = sources.listFormulas(request.center, request.windowDays);
  const found = list?.formulas.find((item) => item.id === request.id);
  return found
    ? ingredientFromFormula(request.center, request.windowDays, found)
    : missing('That title formula is no longer stored. Find the formulas again.');
}

function transfer(sources: FormatSources, request: Of<'transfer-format' | 'transfer-idea'>) {
  const list = sources.listTransfers();
  if (request.kind === 'transfer-format') {
    const format = list.formats.find((item) => item.key === request.key);
    return format
      ? ingredientFromTransferFormat(format)
      : missing('That title format is not on the transfer list any more.');
  }
  const idea = list.ideas.find((item) => item.key === request.key);
  return idea
    ? ingredientFromTransferIdea(idea)
    : missing('That idea is not on the transfer list any more.');
}

function hook(sources: FormatSources, request: Of<'hook'>): Resolved {
  const library = sources.hookLibrary(request.center);
  const found = library?.hooks.find((item) => item.videoId === request.videoId);
  return found && library
    ? ingredientFromHook(request.center, found, library.hooks)
    : missing('That hook is not in this channel’s hook library.');
}

function video(sources: FormatSources, request: Of<'video'>): Resolved {
  const facts = sources.videoFacts(request.videoId);
  return facts
    ? ingredientFromVideo(facts, request.use, request.center)
    : missing('That video is not stored.');
}

function niche(sources: FormatSources, request: Of<'niche'>): Resolved {
  const channel = sources.listNiches().channels.find((item) => item.id === request.channelId);
  return channel ? ingredientFromNiche(channel) : missing('That channel is not on New niches.');
}

function breakdownPart(sources: FormatSources, request: Of<'breakdown-part'>): Resolved {
  const part = sources.findBreakdownPart(request.channelId, request.part);
  if (!part?.written) return missing('That part of the breakdown has not been written.');
  const draft = ingredientFromBreakdownPart({
    channelId: request.channelId,
    channelTitle: sources.channelTitle(request.channelId) ?? request.channelId,
    part: request.part,
    engine: part.engine,
    text: part.text,
    measured: [],
  });
  return request.layer === null ? draft : { ...draft, layer: request.layer };
}

function teardown(sources: FormatSources, request: Of<'teardown'>): Resolved {
  const report = sources.teardownReport(request.videoId);
  const draft = report && ingredientFromTeardown(report, request.section, request.index);
  return draft ?? missing('That part of the teardown has not been made.');
}

function link(sources: FormatSources, request: Of<'link'>): Resolved {
  const facts = sources.videoFacts(request.videoId);
  return facts
    ? ingredientFromVideo(facts, 'link', null)
    : ingredientFromUnreadLink(request.videoId);
}

/** The ingredient a request names, read from the store; or why it cannot be made. */
export function resolveIngredient(sources: FormatSources, request: IngredientRequest): Resolved {
  switch (request.kind) {
    case 'formula':
      return formula(sources, request);
    case 'transfer-format':
    case 'transfer-idea':
      return transfer(sources, request);
    case 'hook':
      return hook(sources, request);
    case 'video':
      return video(sources, request);
    case 'niche':
      return niche(sources, request);
    case 'breakdown-part':
      return breakdownPart(sources, request);
    case 'teardown':
      return teardown(sources, request);
    case 'link':
      return link(sources, request);
    case 'note':
      return ingredientFromNote(request, randomUUID());
    case 'image':
      return ingredientFromImage(request);
    case 'clip':
      return ingredientFromClip(request);
  }
}
