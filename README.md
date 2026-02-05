📖 Overview

This repository demonstrates a legacy-style monolithic application deployed on Amazon Web Services (AWS) using Infrastructure as Code (IaC) with AWS CloudFormation.

The project showcases how a traditional Node.js + MySQL monolith can be provisioned, configured, deployed, and operated in a production-like cloud environment using modern DevOps and cloud engineering best practices.

Key highlights:

Monolithic Node.js inventory application with CRUD operations

EC2-based deployment with automated bootstrapping

Secure environment variable injection using CloudFormation

RDS-backed MySQL database

Process management and auto-restart using PM2 + systemd

Real-time EC2 metadata visibility (Instance ID & AZ)


flowchart TD
    User[End User / Browser]

    CF[AWS CloudFormation]

    EC2[Amazon EC2\nNode.js Monolithic App\nPM2 + systemd]
    RDS[Amazon RDS\nMySQL Database]

    User -->|HTTP Requests| EC2
    EC2 -->|MySQL Queries| RDS

    CF -->|Provisioning| EC2
    CF -->|Provisioning| RDS

    EC2 -->|Reads Metadata| Meta[EC2 Metadata\nInstance ID & AZ]

CloudFormation
 └─ Provisions EC2 + RDS
 └─ Injects DB_HOST / DB_USER / DB_PASS


