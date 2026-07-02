import { afterEach, describe, expect, it, vi } from 'vitest';

const toolsGet = vi.fn();
vi.mock('../../src/integrations/composio.js', () => ({
  COMPOSIO_ORG_USER: 'octane-org',
  COMPOSIO_TOOLKITS: ['ZOHO', 'ZOHO_DESK'],
  getComposio: () => ({ tools: { get: toolsGet } }),
  isComposioAllowed: () => true,
}));

import { env } from '../../src/config/env.js';
import {
  buildComposioToolsFor,
  isComposioWriteTool,
  toolAllowedForToolkits,
} from '../../src/modules/agents/tools/composio.js';
import { makeContext } from '../fixtures/seed.js';

const savedWrites = env.FF_COMPOSIO_WRITES;
afterEach(() => {
  env.FF_COMPOSIO_WRITES = savedWrites;
  toolsGet.mockReset();
});

const fakeTool = (name: string) => ({ name });

describe('write-verb classification', () => {
  it('flags create/update/delete slugs, not gets', () => {
    expect(isComposioWriteTool('ZOHO_DELETE_RECORD')).toBe(true);
    expect(isComposioWriteTool('ZOHO_UPDATE_RECORD')).toBe(true);
    expect(isComposioWriteTool('ZOHO_GET_CONTACT')).toBe(false);
    expect(isComposioWriteTool('ZOHO_DESK_SEARCH_TICKETS')).toBe(false);
  });
});

describe('longest-prefix toolkit matching', () => {
  it('assigns a tool to the most specific enabled toolkit', () => {
    const enabled = ['ZOHO', 'ZOHO_DESK'];
    expect(toolAllowedForToolkits('ZOHO_DESK_UPDATE_TICKET', ['ZOHO_DESK'], enabled)).toBe(true);
    expect(toolAllowedForToolkits('ZOHO_DESK_UPDATE_TICKET', ['ZOHO'], enabled)).toBe(false);
    expect(toolAllowedForToolkits('ZOHO_GET_CONTACT', ['ZOHO'], enabled)).toBe(true);
  });
});

describe('read-only agents never get Composio write tools (even with FF_COMPOSIO_WRITES on)', () => {
  it('opts.readOnly drops write tools regardless of the flag', async () => {
    env.FF_COMPOSIO_WRITES = true;
    toolsGet.mockResolvedValue([fakeTool('ZOHO_GET_CONTACT'), fakeTool('ZOHO_DELETE_RECORD')]);
    const admin = makeContext({ allDepartmentAccess: true });
    const tools = await buildComposioToolsFor(admin, ['ZOHO'], { readOnly: true });
    expect(tools.map((t) => t.name)).toEqual(['ZOHO_GET_CONTACT']);
  });

  it('without readOnly + flag on, write tools are kept', async () => {
    env.FF_COMPOSIO_WRITES = true;
    toolsGet.mockResolvedValue([fakeTool('ZOHO_GET_CONTACT'), fakeTool('ZOHO_DELETE_RECORD')]);
    const admin = makeContext({ allDepartmentAccess: true });
    const tools = await buildComposioToolsFor(admin, ['ZOHO']);
    expect(tools.map((t) => t.name).sort()).toEqual(['ZOHO_DELETE_RECORD', 'ZOHO_GET_CONTACT']);
  });

  it('flag off always drops write tools', async () => {
    env.FF_COMPOSIO_WRITES = false;
    toolsGet.mockResolvedValue([fakeTool('ZOHO_GET_CONTACT'), fakeTool('ZOHO_DELETE_RECORD')]);
    const admin = makeContext({ allDepartmentAccess: true });
    const tools = await buildComposioToolsFor(admin, ['ZOHO']);
    expect(tools.map((t) => t.name)).toEqual(['ZOHO_GET_CONTACT']);
  });
});
