import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    include: ['app/**/*.test.{ts,tsx}', 'lib/**/*.test.{ts,tsx}'],
  },
});
#### Resources

# Community Integrations

Grok is also accessible via your favorite community integrations, enabling you to connect Grok to other parts of your system easily.

## Third-party SDK/frameworks

### LiteLLM

LiteLLM provides a simple SDK or proxy server for calling different LLM providers. If you're using LiteLLM, integrating xAI as your provider is straightforward—just swap out the model name and API key to xAI's Grok model in your configuration.

For latest information and more examples, visit [LiteLLM xAI Provider Documentation](https://docs.litellm.ai/docs/providers/xai).

As a quick start, you can use LiteLLM in the following fashion:

```pythonWithoutSDK
from litellm import completion
import os

os.environ['XAI_API_KEY'] = ""
response = completion(
    model="xai/grok-4.20-reasoning",
    messages=[
        {
            "role": "user",
            "content": "What's the weather like in Boston today in Fahrenheit?",
        }
    ],
    max_tokens=10,
    response_format={ "type": "json_object" },
    seed=123,
    temperature=0.2,
    top_p=0.9,
    user="user",
)
print(response)
```

### Vercel AI SDK

[Vercel's AI SDK](https://sdk.vercel.ai/) supports a [xAI Grok Provider](https://sdk.vercel.ai/providers/ai-sdk-providers/xai) for integrating with xAI API.

By default it uses your xAI API key in `XAI_API_KEY` variable.

To generate text use the `generateText` function:

```javascriptAISDK
import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';

const { text } = await generateText({
    model: xai.responses('grok-4.20-reasoning'),
    prompt: 'Write a vegetarian lasagna recipe for 4 people.',
});
```

You can also customize the setup like the following:

```javascriptAISDK
import { createXai } from '@ai-sdk/xai';

const xai = createXai({
    apiKey: 'your-api-key',
});
```

You can also generate images with the `generateImage` function:

```javascriptAISDK
import { xai } from '@ai-sdk/xai';
import { experimental_generateImage as generateImage } from 'ai';

const { image } = await generateImage({
    model: xai.image('grok-imagine-image'),
    prompt: 'A cat in a tree',
});
```

## Coding assistants

### Continue - VSCode or JetBrains

You can use Continue extension in VSCode or JetBrains with xAI's models.

To start using xAI models with Continue, you can add the following in Continue's config file `~/.continue/config.json`(MacOS and Linux)/`%USERPROFILE%\.continue\config.json`(Windows).

```json
 "models": [
   {
     "title": "grok-4.20-reasoning",
     "provider": "xAI",
     "model": "grok-4.20-reasoning",
     "apiKey": "[XAI_API_KEY]"
   }
 ]
```

Visit [Continue's Documentation](https://docs.continue.dev/chat/model-setup#grok-2-from-xai) for more details.

### Xcode

To use xAI API with Xcode, you need to add xAI API endpoint as a new Model Provider in Xcode coding intelligence.

Go to Xcode -> Settings -> Intelligence, and click on "Add a Provider..." button. In the pop-up menu, enter the following:

* URL: `https://api.x.ai`
* API Key: Your xAI API key starting with `xai-...`, without Bearer
* API Key Header: `Authorization`

For more information, you can review Apple's guide on setting up [a new Model Provider in Xcode coding intelligence](https://developer.apple.com/documentation/xcode/setting-up-coding-intelligence).
