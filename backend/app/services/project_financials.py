from __future__ import annotations

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import Project, ProjectPayment


def list_project_payments(session: Session, project_id: int) -> list[ProjectPayment]:
    return session.exec(
        select(ProjectPayment)
        .where(ProjectPayment.project_id == project_id)
        .order_by(ProjectPayment.payment_date)
    ).all()


def serialize_financials(project: Project, payments: list[ProjectPayment]) -> dict:
    received = sum(p.amount for p in payments if p.payment_type in ("received", "milestone_payment"))
    expenses = sum(abs(p.amount) for p in payments if p.payment_type == "expense")
    invoiced = sum(p.amount for p in payments if p.payment_type == "invoiced")
    contract_amount = project.contract_amount or 0.0
    return {
        "contract_amount": contract_amount,
        "total_received": received,
        "total_expense": expenses,
        "total_invoiced": invoiced,
        "uncollected": invoiced - received,
        "remaining": contract_amount - received,
        "payments": payments,
    }


def get_project_financials(session: Session, project_id: int) -> dict:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    return serialize_financials(project, list_project_payments(session, project_id))


def add_project_payment(
    session: Session,
    project_id: int,
    *,
    amount: float,
    payment_date: str,
    note: str = "",
    payment_type: str = "received",
) -> ProjectPayment:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    normalized_amount = -abs(amount) if payment_type == "expense" else abs(amount)
    payment = ProjectPayment(
        project_id=project_id,
        amount=normalized_amount,
        payment_date=payment_date,
        note=note,
        payment_type=payment_type,
    )
    session.add(payment)
    session.commit()
    session.refresh(payment)
    return payment


def delete_project_payment(session: Session, project_id: int, payment_id: int) -> None:
    payment = session.get(ProjectPayment, payment_id)
    if not payment or payment.project_id != project_id:
        raise HTTPException(404, "Payment not found")
    session.delete(payment)
    session.commit()
