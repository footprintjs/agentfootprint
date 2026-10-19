import {
  ArtifactDetailError,
  artifactDetailTool,
  type ArtifactDetailArgs,
  type ArtifactDetailErrorCode,
  type ArtifactDetailResult,
  type ArtifactRef,
  type Tool,
  type ToolExecutionContext,
} from '../../src/index.js';

const tool: Tool<ArtifactDetailArgs, ArtifactDetailResult> = artifactDetailTool({
  name: 'open_proof',
  async admit(ref: ArtifactRef, ctx: ToolExecutionContext) {
    const parcel = await ctx.artifacts.get(ref);
    if (!parcel) throw new Error('Unavailable');
    return parcel.data;
  },
  context: (_root, path) => ({ path, claimAuthority: 'unchanged' }),
});
const code: ArtifactDetailErrorCode = new ArtifactDetailError('ERR_ARTIFACT_DETAIL_CANCELLED').code;
void code;
void tool;

function narrow(result: ArtifactDetailResult) {
  if (result.mode === 'children') {
    const args: ArtifactDetailArgs | undefined = result.children[0]?.action.args;
    void args;
    // @ts-expect-error A child page does not pretend to contain the selected value.
    result.value;
  } else if (result.mode === 'scalar-omitted') {
    const withheld: false = result.complete;
    void withheld;
    // @ts-expect-error An omitted scalar has no partial value.
    result.value;
  } else {
    const complete: true = result.complete;
    void complete;
  }
}
void narrow;

// @ts-expect-error Work limits are not model-controlled navigation arguments.
const excessive: ArtifactDetailArgs = { ref: 'art_example', path: '', maxBytes: 10_000_000 };
void excessive;
// @ts-expect-error The refusal vocabulary is closed.
const invented: ArtifactDetailErrorCode = 'ERR_FABRICATED_AUTHORITY';
void invented;
