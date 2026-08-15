provider "digitalocean" {
  token = var.do_token
}

resource "digitalocean_droplet" "staging" {
  name   = "lis-staging"
  region = "nyc1"
  # #564: bumped from s-1vcpu-1gb (1GiB RAM, 848Mi already budgeted across
  # postgres/valkey/keycloak/api/web -- only ~110Mi headroom, not enough for
  # MinIO's ~80-150MB realistic minimum). s-1vcpu-2gb doubles usable RAM to
  # ~1949Mi. The disk bump (25GB->50GB) that comes with this size class is a
  # no-op in practice -- docker's data-root already lives on the separately
  # attached digitalocean_volume.staging_docker_data below, not the root
  # disk. DigitalOcean powers the droplet off briefly to apply a size change
  # that includes a disk increase; acceptable for a staging box.
  size  = "s-1vcpu-2gb"
  image = "ubuntu-24-04-x64"
}

import {
  to = digitalocean_droplet.staging
  id = var.droplet_id
}

# The 25GB root disk filled up (100% -- Docker images/containers/volumes
# under /var/lib/docker). Manually created and attached via the DO console
# (not by Terraform, same as the droplet itself), then Docker's data-root
# was moved onto it -- see docker-compose.staging.yml's top-of-file comment
# for the on-droplet migration steps. A data source, not an imported
# resource: Terraform only needs to reference it (for the attachment below),
# not manage its lifecycle -- it should never create, resize, or destroy
# this volume.
data "digitalocean_volume" "staging_docker_data" {
  name   = "volume-nyc1-1785507357628"
  region = "nyc1"
}

# The attachment itself already exists (done manually alongside the volume
# creation above). Do NOT `terraform apply` this until it's been imported
# first, or Terraform may try to create a second attachment for an already-
# attached volume. Run `terraform plan` first; if it proposes a change
# instead of a clean no-op, import before applying:
#   terraform import digitalocean_volume_attachment.staging_docker_data \
#     <volume_id>,<droplet_id>
# (comma-separated composite ID, matching this provider's other *_attachment
# resources -- not independently confirmed for this specific resource, so
# verify against `terraform plan`'s own error message if the format differs.)
resource "digitalocean_volume_attachment" "staging_docker_data" {
  droplet_id = digitalocean_droplet.staging.id
  volume_id  = data.digitalocean_volume.staging_docker_data.id
}

resource "digitalocean_firewall" "staging" {
  name        = "lis-staging-fw"
  droplet_ids = [digitalocean_droplet.staging.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = [var.ssh_allowed_ip]
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  inbound_rule {
  protocol         = "udp"
  port_range       = "41641"
  source_addresses = ["0.0.0.0/0", "::/0"]
}

  outbound_rule {
    protocol              = "tcp"
    port_range             = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "udp"
    port_range             = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

output "staging_ip" {
  value = digitalocean_droplet.staging.ipv4_address
}
