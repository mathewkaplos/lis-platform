variable "do_token" {
  description = "DigitalOcean API token — supplied via terraform.tfvars, NEVER committed"
  type        = string
  sensitive   = true
}

variable "droplet_id" {
  description = "ID of the pre-existing staging droplet to import"
  type        = string
}

variable "ssh_allowed_ip" {
  description = "Your IP address, for SSH access via the firewall (CIDR, e.g. 1.2.3.4/32)"
  type        = string
}
