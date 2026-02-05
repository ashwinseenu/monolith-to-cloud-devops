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


graph LR
    %% Styles
    classDef aws fill:#FF9900,stroke:#232F3E,color:white,stroke-width:2px;
    classDef db fill:#3F8624,stroke:#232F3E,color:white,stroke-width:2px;
    classDef comp fill:#E05243,stroke:#232F3E,color:white,stroke-width:2px;
    classDef net fill:#8C4FFF,stroke:#232F3E,color:white,stroke-width:2px;
    
    User((Client / User)) -->|HTTPS/HTTP| IGW[Internet Gateway]
    
    subgraph VPC [AWS Cloud - VPC: 10.0.0.0/16]
        IGW --> ALB
        
        subgraph AZ1 [Availability Zone 1]
            SN1[Public Subnet 1]
            EC2[<b>EC2 App Server</b><br/>Node.js Monolith<br/>Port 3000]:::comp
        end
        
        subgraph AZ2 [Availability Zone 2]
            SN2[Public Subnet 2]
            REPL[Standby / Failover Zone]:::net
        end
        
        ALB[<b>Application Load Balancer</b><br/>Port 80 / 443]:::aws
        RDS[(<b>Amazon RDS</b><br/>MySQL 8.4<br/>Port 3306)]:::db
        
        %% Traffic Flows
        ALB -->|HTTP: 80| EC2
        EC2 -->|SQL: 3306| RDS
        
        %% Network Associations
        SN1 -.-> ALB
        SN2 -.-> ALB
        SN1 --- EC2
    end
