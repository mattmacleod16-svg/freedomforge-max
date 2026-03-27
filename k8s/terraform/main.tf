terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.0"
    }
  }
}

provider "helm" {
  kubernetes {
    config_path = "~/.kube/config"
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

# ─── Istio Service Mesh (Helm) ────────────────────────────────────────────────

resource "helm_release" "istio_base" {
  name             = "istio-base"
  repository       = "https://istio-release.storage.googleapis.com/charts"
  chart            = "base"
  namespace        = "istio-system"
  create_namespace = true
  version          = "1.22.0"

  depends_on = [kubernetes_namespace.freedomforge_system]
}

resource "helm_release" "istiod" {
  name       = "istiod"
  repository = "https://istio-release.storage.googleapis.com/charts"
  chart      = "istiod"
  namespace  = "istio-system"
  version    = "1.22.0"

  set {
    name  = "global.meshID"
    value = "freedomforge-mesh"
  }

  set {
    name  = "global.network"
    value = "network1"
  }

  depends_on = [helm_release.istio_base]
}

resource "helm_release" "istio_ingress" {
  name       = "istio-ingressgateway"
  repository = "https://istio-release.storage.googleapis.com/charts"
  chart      = "gateway"
  namespace  = "istio-system"
  version    = "1.22.0"

  depends_on = [helm_release.istiod]
}

# ─── ArgoCD ───────────────────────────────────────────────────────────────────

resource "helm_release" "argocd" {
  name             = "argocd"
  repository       = "https://argoproj.github.io/argo-helm"
  chart            = "argo-cd"
  namespace        = "argocd"
  create_namespace = true
  version          = "6.7.0"

  set {
    name  = "server.extraArgs[0]"
    value = "--insecure"
  }

  depends_on = [helm_release.istiod]
}

# Enable Istio sidecar injection in app namespaces
resource "kubernetes_labels" "istio_injection_earth" {
  api_version = "v1"
  kind        = "Namespace"
  metadata {
    name = kubernetes_namespace.freedomforge_earth.metadata[0].name
  }
  labels = {
    "istio-injection" = "enabled"
  }
}

resource "kubernetes_labels" "istio_injection_system" {
  api_version = "v1"
  kind        = "Namespace"
  metadata {
    name = kubernetes_namespace.freedomforge_system.metadata[0].name
  }
  labels = {
    "istio-injection" = "enabled"
  }
}

# ─── WASM Guardian Filter + SPIFFE federation manifests ──────────────────────

resource "kubernetes_manifest" "wasm_guardian_filter" {
  manifest = yamldecode(file("${path.module}/../istio/wasm/guardian-filter.yaml"))

  depends_on = [
    helm_release.istiod,
    kubernetes_namespace.freedomforge_earth,
  ]
}

resource "kubernetes_manifest" "spiffe_federation" {
  manifest = yamldecode(file("${path.module}/../istio/mesh/peerauthentication-spiffe.yaml"))

  depends_on = [
    helm_release.istiod,
    kubernetes_namespace.freedomforge_earth,
    kubernetes_namespace.freedomforge_system,
  ]
}
