# AWS Bedrock AgentCore Runtime container for an agentfootprint agent.
# AgentCore requires an ARM64 image that serves the runtime HTTP contract on :8080.
#
#   docker buildx build --platform linux/arm64 -t my-agent:latest .
#   # push to ECR, then create the runtime:
#   # aws bedrock-agentcore-control create-agent-runtime --container-uri <ecr-uri> ...
#
# The same image runs the example file with AGENTCORE_SERVE=1 so it listens
# forever (instead of self-testing + exiting).

FROM --platform=linux/arm64 node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM --platform=linux/arm64 node:22-slim
WORKDIR /app
ENV NODE_ENV=production AGENTCORE_SERVE=1
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Point this at YOUR compiled server entry (the agentcore-runtime handler).
# Production agents call providerFromEnv() (Bedrock) instead of mock().
EXPOSE 8080
CMD ["node", "dist/your-agentcore-server.js"]
