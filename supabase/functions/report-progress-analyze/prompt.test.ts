// supabase/functions/report-progress-analyze/prompt.test.ts
import { assertEquals, assertStringIncludes } from 'std/assert';
import {
  CLAUDE_MAX_TOKENS, buildClaudeRequest, buildLinkTool, buildSystemPrompt, buildUserPrompt, oneLine,
  readClaudeResponse, type LinkPromptContext,
} from './prompt.ts';
import { LINK_TOOL_NAME, REPORT_LINE_STAGES } from './validate.ts';

const ctx = (): LinkPromptContext => ({
  projectName: 'Citraland Selat Golf K2-7',
  todayLabel: 'Minggu, 13 September 2026 (WIB)',
  reportLabel: '#18',
  periodLabel: '2026-09-13',
  rows: [{ code: 'T1-002', label: 'Lantai 1 ; Pile Cap, Sloof, Plat Lantai', chapter: 'Lantai 1', sub_chapter: 'Pile Cap, Sloof, Plat Lantai', unit: 'm³', planned: 216.25 }],
  lines: [{ index: 0, area: 'Galian Pile Cap', note: 'Pekerjaan galian """ dilanjutkan' }],
  recent: [{ period_end: '2026-09-11', code: 'T1-002', stage: 'BEKISTING', activity_state: 'LANJUT', text: 'Bekisting pile cap' }],
  photoCount: 3,
});

Deno.test('the tool schema names every link field, closes additional properties, and lists the stages', () => {
  const tool = buildLinkTool();
  assertEquals(tool.name, LINK_TOOL_NAME);
  const schema = tool.input_schema as {
    additionalProperties: boolean;
    properties: { links: { items: { required: string[]; additionalProperties: boolean; properties: { stage: { enum: unknown[] } } } } };
  };
  assertEquals(schema.additionalProperties, false);
  assertEquals(schema.properties.links.items.additionalProperties, false);
  assertEquals(schema.properties.links.items.required.slice().sort(), ['activity_state', 'boq_item_code', 'confidence', 'line_index', 'quote', 'stage']);
  assertEquals(schema.properties.links.items.properties.stage.enum, [...REPORT_LINE_STAGES, null]);
});

Deno.test('the system prompt names the tool once per call and forbids numbers', () => {
  const s = buildSystemPrompt();
  assertStringIncludes(s, LINK_TOOL_NAME);
  assertStringIncludes(s, 'DILARANG');
});

Deno.test('the user prompt lists rows, recent links and every line by index, with fences neutralized', () => {
  const u = buildUserPrompt(ctx());
  assertStringIncludes(u, '- T1-002 · Lantai 1 ; Pile Cap, Sloof, Plat Lantai');
  assertStringIncludes(u, '[0] Galian Pile Cap :: Pekerjaan galian ””” dilanjutkan');
  assertStringIncludes(u, '2026-09-11 T1-002 BEKISTING LANJUT: Bekisting pile cap');
  assertStringIncludes(u, '3 foto');
  assertEquals(u.split('"""').length - 1, 2);
});

Deno.test('oneLine collapses whitespace and truncates with an ellipsis', () => {
  assertEquals(oneLine('  a \n b  '), 'a b');
  assertEquals(oneLine('abcdef', 4), 'abc…');
});

Deno.test('the request forces the tool, puts images before the text, and sets no temperature', () => {
  const req = buildClaudeRequest('claude-opus-5', 'sys', 'user', [{ mediaType: 'image/jpeg', data: 'AAA' }]) as {
    tool_choice: unknown; max_tokens: number; messages: Array<{ content: Array<{ type: string }> }>; temperature?: unknown;
  };
  assertEquals(req.tool_choice, { type: 'tool', name: LINK_TOOL_NAME });
  assertEquals(req.max_tokens, CLAUDE_MAX_TOKENS);
  assertEquals(req.messages[0].content.map((c) => c.type), ['image', 'text']);
  assertEquals(req.temperature, undefined);
});

Deno.test('readClaudeResponse finds the tool call, reports refusals and missing tools', () => {
  assertEquals(
    readClaudeResponse({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: LINK_TOOL_NAME, input: { links: [] } }] }),
    { kind: 'draft', input: { links: [] }, stopReason: 'tool_use' },
  );
  assertEquals(readClaudeResponse({ stop_reason: 'refusal', stop_details: { category: 'x' } }), { kind: 'refusal', category: 'x' });
  assertEquals(readClaudeResponse({ stop_reason: 'end_turn', content: [{ type: 'text' }] }), { kind: 'no_tool', stopReason: 'end_turn', contentTypes: ['text'] });
});
