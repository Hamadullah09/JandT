# syntax=docker/dockerfile:1.7
# =============================================================================
# Warehouse API + dashboard - one image.
#
#   1. dashboard  React/Vite build, written into the API's wwwroot
#   2. build      dotnet publish (framework-dependent)
#   3. runtime    ASP.NET Core 10, non-root, health-checked
#
# The photo-search model (85 MB) and product photos are NOT baked in: they are
# mounted at /models and /data/uploads (see docker-compose.yml), so an image
# rebuild never touches data and the image stays small.
# =============================================================================

# ---------------------------------------------------------------- dashboard
FROM node:20-alpine AS dashboard
WORKDIR /src/dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY dashboard/ ./
# vite.config.js writes to ../server/Warehouse.Api/wwwroot
RUN mkdir -p ../server/Warehouse.Api && npm run build

# -------------------------------------------------------------------- build
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
ENV NUGET_ENABLE_ENHANCED_HTTP_RETRY=true \
    NUGET_ENHANCED_MAX_NETWORK_TRY_COUNT=10 \
    DOTNET_CLI_TELEMETRY_OPTOUT=1
COPY server/Warehouse.Api/Warehouse.Api.csproj server/Warehouse.Api/
RUN --mount=type=cache,id=nuget,target=/root/.nuget/packages \
    dotnet restore server/Warehouse.Api/Warehouse.Api.csproj -r linux-x64
COPY server/Warehouse.Api/ server/Warehouse.Api/
COPY --from=dashboard /src/server/Warehouse.Api/wwwroot server/Warehouse.Api/wwwroot
RUN --mount=type=cache,id=nuget,target=/root/.nuget/packages \
    dotnet publish server/Warehouse.Api/Warehouse.Api.csproj \
      -c Release -r linux-x64 --self-contained false --no-restore \
      -o /app /p:UseAppHost=false

# ------------------------------------------------------------------ runtime
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime

# curl for the container health check; nothing else is added to the base image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app ./

ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_RUNNING_IN_CONTAINER=true \
    Uploads__Path=/data/uploads \
    PhotoSearch__ModelPath=/models/dinov2-small.onnx

RUN mkdir -p /data/uploads /models && chown -R $APP_UID /data

USER $APP_UID
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8080/health/ready > /dev/null || exit 1

ENTRYPOINT ["dotnet", "Warehouse.Api.dll"]
