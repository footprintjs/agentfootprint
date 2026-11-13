import { closeStage } from './stages/close/close.js';
import { flowChart } from 'footprintjs';
import type { Facts } from './call.js';
import { finish, chooseRead, chooseOwnership } from './run.js';
import { saveStage, chooseSave } from './stages/save/save.js';
import { readStage } from './stages/read/read.js';
import { decodeStage } from './stages/decode/decode.js';
import { listStage } from './stages/list/list.js';
import { projectStage } from './stages/project/project.js';
import { ownerStage } from './stages/owner/owner.js';
import { forgetStage } from './stages/forget/forget.js';
import { ownershipStage, refuseOwnership } from './stages/ownership/ownership.js';
import { writeStage } from './stages/write/write.js';
import { completeStage } from './stages/complete/complete.js';

export const saveChart = flowChart<Facts>('Validate, snapshot and start save', saveStage, 'save')
  .addDeciderFunction('Save outcome', chooseSave, 'save-outcome')
  .addFunctionBranch('refuse', 'Preserve refusal', completeStage)
  .addFunctionBranch('complete', 'Saved', completeStage)
  .end()
  .build();

export const hydrateChart = flowChart<Facts>('Read session row', readStage, 'hydrate')
  .addDeciderFunction('Stored row', chooseRead, 'stored-row')
  .addFunctionBranch('refuse', 'Preserve read refusal', completeStage)
  .addFunctionBranch('absent', 'No stored session', completeStage)
  .addFunctionBranch('decode', 'Decode and validate envelope', decodeStage)
  .end()
  .build();

export const listChart = flowChart<Facts>('Parse cursor and query page', listStage, 'list')
  .addDeciderFunction('Query outcome', finish, 'query-outcome')
  .addFunctionBranch('refuse', 'Preserve query refusal', completeStage)
  .addFunctionBranch('complete', 'Project page and cursor', projectStage)
  .end()
  .build();

export const ownerChart = flowChart<Facts>('Read ownership row', readStage, 'owner')
  .addDeciderFunction('Read outcome', finish, 'owner-outcome')
  .addFunctionBranch('refuse', 'Preserve read refusal', completeStage)
  .addFunctionBranch('complete', 'Read established owner', ownerStage)
  .end()
  .build();

export const forgetChart = flowChart<Facts>('Delete session document', forgetStage, 'forget')
  .addDeciderFunction('Delete outcome', finish, 'forget-outcome')
  .addFunctionBranch('refuse', 'Preserve delete refusal', completeStage)
  .addFunctionBranch('complete', 'Forgotten', completeStage)
  .end()
  .build();

export const ownershipChart = flowChart<Facts>(
  'Read and resolve transaction owner',
  ownershipStage,
  'ownership',
)
  .addDeciderFunction('Owner may write', chooseOwnership, 'owner-may-write')
  .addFunctionBranch('refuse', 'Different signer or read failed', refuseOwnership)
  .addFunctionBranch('write', 'Replace row with established owner', writeStage)
  .end()
  .build();

export const closeChart = flowChart<Facts>('Close owned client', closeStage, 'close')
  .addDeciderFunction('Close outcome', finish, 'close-outcome')
  .addFunctionBranch('refuse', 'Preserve close refusal', completeStage)
  .addFunctionBranch('complete', 'Closed', completeStage)
  .end()
  .build();
