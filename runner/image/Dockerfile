# The g-cauc job image: GitHub's runner image plus what the projects' scripts/dev needs.
# Each CI job starts a fresh container from this image and it is removed when the job ends.
FROM ghcr.io/actions/actions-runner:2.337.0

USER root
ARG TARGETARCH
ARG COMPOSE_VERSION=v5.6.0
ARG COMPOSE_SHA256_ARM64=733ec76717ceb59052a9609b9dadfb523b2df8eab57a54212872d10a58078ea2
ARG COMPOSE_SHA256_AMD64=40343e21ca777173e69cff5dbafeb37c6f81f3b0d57d9e597f036e95eb63e76a
RUN set -eux; \
    apt-get update; \
    # libatomic1: Node's arm64 builds need it (setup-node failed without it on the first job).
    # rsync: GitHub's hosted runners have it, and CallFlow's fail-closed test uses it (PR 202).
    apt-get install -y --no-install-recommends postgresql-client openssl xz-utils zstd libatomic1 \
      build-essential pkg-config rsync; \
    rm -rf /var/lib/apt/lists/*; \
    case "${TARGETARCH:-$(dpkg --print-architecture)}" in \
      arm64) asset=aarch64; sum="$COMPOSE_SHA256_ARM64" ;; \
      amd64) asset=x86_64; sum="$COMPOSE_SHA256_AMD64" ;; \
      *) echo "unsupported architecture" >&2; exit 1 ;; \
    esac; \
    mkdir -p /usr/local/lib/docker/cli-plugins; \
    curl -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \
      "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-${asset}"; \
    echo "${sum}  /usr/local/lib/docker/cli-plugins/docker-compose" | sha256sum -c -; \
    chmod 0755 /usr/local/lib/docker/cli-plugins/docker-compose
USER runner
