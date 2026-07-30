provider "digitalocean" {
  token = var.do_token
}

resource "digitalocean_droplet" "staging" {
  name   = "lis-staging"
  region = "nyc1"
  size   = "s-1vcpu-1gb"
  image  = "ubuntu-24-04-x64"
}

import {
  to = digitalocean_droplet.staging
  id = var.droplet_id
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
