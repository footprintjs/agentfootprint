import { describe, expect, it } from 'vitest';
import type { ActOptions } from '../../act.js';
import { allow } from '../../middleware/outcomes.js';
import type { MessageMiddleware, ToolMiddleware } from '../../middleware/types.js';
import type { WindowStrategy } from '../../window/strategy.js';
import { configureAct, type ActPort } from './configure.js';

describe('the builder posture declaration', () => {
  it('records the window door before live dispatch and attaches messages before tools', () => {
    const calls: string[] = [];
    const window: WindowStrategy = { name: 'keep', plan: async () => undefined };
    const message: MessageMiddleware = { name: 'message', onMessage: () => allow() };
    const tool: ToolMiddleware = { name: 'tool', onToolCall: () => allow() };
    const receiver: ActPort = {
      actCalled: false,
      assertNoWindowStrategy(door) {
        expect(this).toBe(receiver);
        calls.push('check:' + door);
      },
      noteWindowStrategyDoor(door) {
        calls.push('note:' + door);
      },
      window(strategy) {
        expect(strategy).toBe(window);
        expect(this.actCalled).toBe(false);
        calls.push('window');
      },
      messageMiddleware(...entries) {
        expect(this.actCalled).toBe(true);
        expect(entries).toEqual([message]);
        calls.push('messages');
      },
      toolMiddleware(...entries) {
        expect(entries).toEqual([tool]);
        calls.push('tools');
      },
    };
    const original = {};
    expect(
      configureAct(
        receiver,
        { input: [message], output: [message], beforeTool: [tool], window },
        original,
      ),
    ).toBe(original);
    expect(calls).toEqual(['check:act', 'note:.act({ window })', 'window', 'messages', 'tools']);
  });

  it('refuses a malformed later key before attaching an otherwise valid window', () => {
    const calls: string[] = [];
    const receiver: ActPort = {
      actCalled: false,
      assertNoWindowStrategy: () => calls.push('check'),
      noteWindowStrategyDoor: () => calls.push('note'),
      window: () => calls.push('window'),
      messageMiddleware: () => calls.push('messages'),
      toolMiddleware: () => calls.push('tools'),
    };
    const options = { window: { name: 'keep', plan: async () => undefined }, output: [{}] };
    expect(() => configureAct(receiver, options as unknown as ActOptions, receiver)).toThrow(
      /output.*name/,
    );
    expect(calls).toEqual([]);
    expect(receiver.actCalled).toBe(false);
  });
});
