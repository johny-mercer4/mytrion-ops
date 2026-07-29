import {
  BrowserAutomationHttpError,
  browserAutomationRequest,
} from '../../integrations/browserAutomation.js';
import { AppError } from '../../lib/errors.js';
import { assertWexApplicationActionAllowed } from '../sales/wexApplicationGuard.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface CloseApplicationInput {
  assignedTo: string;
  priority: '' | 'High' | 'Normal' | 'Low';
  dueDate: string;
  status: string;
}

export async function closeWexApplication(
  appId: string,
  input: CloseApplicationInput,
): Promise<unknown> {
  await assertWexApplicationActionAllowed(appId, 'Close Application');

  let result: unknown;
  try {
    result = await browserAutomationRequest(
      'POST',
      `/wex/application/${encodeURIComponent(appId)}/close`,
      { body: input },
    );
  } catch (cause) {
    if (cause instanceof BrowserAutomationHttpError) {
      const passthrough = [400, 404, 409, 422].includes(cause.status);
      throw new AppError(
        passthrough
          ? cause.bodyText || `Browser automation rejected the request (${cause.status}).`
          : 'Browser automation request failed.',
        {
          statusCode: passthrough ? cause.status : 502,
          code: passthrough ? 'BROWSER_AUTO_REJECTED' : 'BROWSER_AUTO_ERROR',
          expose: true,
          cause,
        },
      );
    }
    throw cause;
  }

  if (isRecord(result) && result.success === false) {
    const message = typeof result.message === 'string' && result.message
      ? result.message
      : typeof result.error === 'string' && result.error
        ? result.error
        : 'Browser automation rejected the request.';
    throw new AppError(message, {
      statusCode: 422,
      code: 'BROWSER_AUTO_REJECTED',
      expose: true,
    });
  }
  return result;
}
