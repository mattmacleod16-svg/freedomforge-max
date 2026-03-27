terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.0"
    }
  }
}

provider "kubernetes" {
  config_path = "~/.kube/config"
}

# ─── Namespaces (one per deployment zone) ────────────────────────────────────

resource "kubernetes_namespace" "freedomforge_earth" {
  metadata {
    name = "freedomforge-earth"
    labels = {
      "app.kubernetes.io/part-of" = "freedomforge-max"
      "zone"                       = "earth"
    }
  }
}

resource "kubernetes_namespace" "freedomforge_lunar" {
  metadata {
    name = "freedomforge-lunar"
    labels = {
      "app.kubernetes.io/part-of" = "freedomforge-max"
      "zone"                       = "lunar"
    }
  }
}

resource "kubernetes_namespace" "freedomforge_mars" {
  metadata {
    name = "freedomforge-mars"
    labels = {
      "app.kubernetes.io/part-of" = "freedomforge-max"
      "zone"                       = "mars"
    }
  }
}

resource "kubernetes_namespace" "freedomforge_system" {
  metadata {
    name = "freedomforge-system"
    labels = {
      "app.kubernetes.io/part-of" = "freedomforge-max"
    }
  }
}

# ─── CRD ─────────────────────────────────────────────────────────────────────

resource "kubernetes_manifest" "freedomforge_crd" {
  manifest = yamldecode(file("${path.module}/../crds/freedomforge-agent.yaml"))
}

# ─── Guardian Operator ────────────────────────────────────────────────────────

resource "kubernetes_manifest" "guardian_operator" {
  for_each = toset([
    "ServiceAccount",
    "ClusterRole",
    "ClusterRoleBinding",
    "Deployment",
  ])

  manifest = yamldecode(file("${path.module}/../operators/guardian-operator.yaml"))

  depends_on = [
    kubernetes_namespace.freedomforge_system,
    kubernetes_manifest.freedomforge_crd,
  ]
}

# ─── Core App Deployment (Earth primary cluster) ──────────────────────────────

resource "kubernetes_deployment" "freedomforge_core" {
  metadata {
    name      = "freedomforge-core"
    namespace = kubernetes_namespace.freedomforge_earth.metadata[0].name
    labels = {
      app   = "freedomforge"
      zone  = "earth"
    }
  }

  spec {
    replicas = 3

    selector {
      match_labels = {
        app = "freedomforge"
      }
    }

    template {
      metadata {
        labels = {
          app  = "freedomforge"
          zone = "earth"
        }
      }

      spec {
        container {
          image             = "freedomforge/max:latest"
          image_pull_policy = "IfNotPresent"
          name              = "freedomforge"

          port {
            container_port = 3000
            name           = "http"
          }

          env {
            name  = "NODE_ENV"
            value = "production"
          }

          resources {
            requests = {
              cpu    = "250m"
              memory = "512Mi"
            }
            limits = {
              cpu    = "1000m"
              memory = "1Gi"
            }
          }

          liveness_probe {
            http_get {
              path = "/api/health"
              port = 3000
            }
            initial_delay_seconds = 15
            period_seconds        = 20
          }

          readiness_probe {
            http_get {
              path = "/api/health"
              port = 3000
            }
            initial_delay_seconds = 5
            period_seconds        = 10
          }
        }
      }
    }
  }

  depends_on = [kubernetes_namespace.freedomforge_earth]
}

resource "kubernetes_service" "freedomforge_core" {
  metadata {
    name      = "freedomforge-core"
    namespace = kubernetes_namespace.freedomforge_earth.metadata[0].name
  }

  spec {
    selector = {
      app = "freedomforge"
    }

    port {
      port        = 80
      target_port = 3000
    }

    type = "ClusterIP"
  }
}
